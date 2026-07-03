#!/usr/bin/env python3
"""Enrich blank vendor contact fields via the Tavily Search API (no OpenAI).

For every greendogops.crm_organization row (Vendor & Partner directory) that is
missing website / phone / email / address / city / state / zip, this runs a
Tavily web search, discovers the official website, and extracts contact facts
from the top results' content. Only currently-blank columns are emitted (as
`coalesce(col, '...')`), so existing data is never replaced.

Precision guards (to avoid junk from directories):
  * website : first non-directory, non-social result URL.
  * email   : only when its domain matches the discovered official website
              (or an existing website), so we never grab a stranger's address.
  * phone   : first well-formed US phone found in the results.
  * address : only a complete "street, City, ST 12345" block.

Cache: .data/_vendor_tavily_cache.json (re-runs are free). SQL -> stdout.

Usage:
    set -a; source .secrets/enrich.env; set +a
    python scripts/enrich_vendors_tavily.py --dump .data/_vendors.json --limit 15 > out.sql
    python scripts/enrich_vendors_tavily.py --dump .data/_vendors.json          > .data/_tavily_fills.sql
    ./scripts/supabase-sql.sh -f .data/_tavily_fills.sql
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

TAVILY_KEY = os.environ.get("TAVILY_API_KEY", "")
TAVILY_URL = "https://api.tavily.com/search"
CACHE = ".data/_vendor_tavily_cache.json"
ENRICH_FIELDS = ("website", "phone", "email", "address", "city", "state", "zip")

STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
STRICT_EMAIL = re.compile(r"^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9.\-]+\.[a-z]{2,}$")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)")
ADDR_RE = re.compile(
    r"(\d{1,6}\s+[A-Za-z0-9 .,'#\-]{3,60}?),\s*([A-Za-z .'\-]{2,40}),\s*([A-Z]{2})\.?\s+(\d{5})(?:-\d{4})?"
)
BAD_EMAIL_HINT = re.compile(r"(sentry|example\.|\.png|\.jpg|\.jpeg|\.gif|\.svg|@2x|wixpress|godaddy|@domain|yourname|sentry\.io|wordpress|\.webp)", re.I)
DIRECTORY_HOSTS = (
    "yelp.", "zoominfo.", "facebook.", "instagram.", "linkedin.", "mapquest.",
    "yellowpages.", "bbb.org", "indeed.", "glassdoor.", "tripadvisor.",
    "google.", "apple.", "foursquare.", "nextdoor.", "pinterest.", "twitter.",
    "x.com", "tiktok.", "crunchbase.", "dnb.com", "buzzfile.", "manta.",
    "chamberofcommerce.", "birdeye.", "threadfin.", "wikipedia.", "youtube.",
    "petfinder.", "adoptapet.", "guidestar.", "yellow.", "cylex", "loc8nearme",
    "mapcarta", "ezlocal", "hotfrog", "brownbook", "expo", "eventbrite.",
    "wheree.", "bizapedia", "citysearch", "superpages", "local.com", "n49.",
    "opendi", "find-us-here", "storeboard", "elocal", "americantowns", "yalwa",
    "fyple", "cybo.", "tuugo", "bunity", "yellow.place", "trustpilot", "signalhire",
    "rocketreach", "apollo.io", "leadiq", "kona", "getpaws", "pawmaw", "gomarry",
    "topratedlocal", "chamberofcommerce", "merchantcircle", "houzz.", "angi.",
    "thumbtack", "nextdoor", "mapquest", "waze", "bing.", "yahoo.", "reddit.",
    "medium.", "wordpress.", "blogspot", "amazon.", "ebay.", "etsy.",
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# Global rate limiter: enforce a minimum interval between ALL requests (across
# threads) so we never trip Tavily's throttle in the first place.
_RL_LOCK = threading.Lock()
_RL_LAST = [0.0]
MIN_INTERVAL = float(os.environ.get("TAVILY_MIN_INTERVAL", "0"))


def _throttle():
    with _RL_LOCK:
        wait = MIN_INTERVAL - (time.time() - _RL_LAST[0])
        if wait > 0:
            time.sleep(wait)
        _RL_LAST[0] = time.time()


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "")
    return (m.group(1).lower().lstrip("www.") if m else "")


def is_directory(url: str) -> bool:
    h = host_of(url)
    return any(d in h for d in DIRECTORY_HOSTS)


def tavily(query: str) -> dict | None:
    """Search Tavily. Returns the JSON dict, or None if the search could not be
    completed (network / rate-limit). Callers treat None as "retry later" and do
    NOT cache it."""
    body = json.dumps({
        "api_key": TAVILY_KEY,
        "query": query,
        "search_depth": os.environ.get("TAVILY_DEPTH", "basic"),
        "max_results": 6,
        "include_raw_content": True,
    }).encode()
    for attempt in range(9):
        _throttle()
        req = urllib.request.Request(
            TAVILY_URL, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:120]
            if e.code in (429, 432, 433) or "excessive" in msg.lower() or "blocked" in msg.lower():
                time.sleep(min(2 ** attempt, 25) + random.random())  # patient backoff
                continue
            log(f"  ! HTTP {e.code}: {msg}")
            return None
        except Exception as e:  # noqa: BLE001
            time.sleep(2 + random.random())
            if attempt == 8:
                log(f"  ! error: {e}")
    return None


def pick_phone(text: str) -> str | None:
    for a, b, c in PHONE_RE.findall(text):
        return f"({a}) {b}-{c}"
    return None


def pick_address(text: str):
    m = ADDR_RE.search(text)
    if not m:
        return None
    street, city, st, zp = (x.strip(" ,") for x in m.groups())
    st = st.upper()
    if st not in STATES or len(street) > 60 or len(city) > 40:
        return None
    return {"address": street, "city": city, "state": st, "zip": zp}


def pick_email(text: str, official_domain: str) -> str | None:
    if not official_domain:
        return None
    for e in EMAIL_RE.findall(text):
        e = e.strip().strip(".").lower()
        if BAD_EMAIL_HINT.search(e) or not STRICT_EMAIL.match(e):
            continue
        if e.split("@")[1] == official_domain:
            return e
    return None


STOP_TOKENS = {
    "pet", "pets", "dog", "dogs", "cat", "cats", "the", "and", "inc", "llc",
    "shop", "care", "store", "group", "company", "services", "service",
    "animal", "animals", "los", "angeles", "california",
}


def name_tokens(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (name or "").lower())
            if len(w) >= 4 and w not in STOP_TOKENS}


def domain_matches_name(url: str, tokens: set[str]) -> bool:
    dom = re.sub(r"[^a-z0-9]", "", host_of(url).split(".")[0])
    return any(t in dom for t in tokens) if dom and tokens else False


def enrich(v: dict) -> dict:
    """Enrich ONLY when a same-state (default CA) address anchors the match.

    Tavily readily returns same-name businesses in other cities, so we require a
    verifiable local address as the anchor and read the phone from that same
    page — anything not tied to that locality is skipped rather than risk a wrong
    value in a blank field.
    """
    name = v["name"]
    rec_state = (v.get("state") or "").strip().upper()
    rec_city = (v.get("city") or "").strip()
    hint = " ".join(x for x in (rec_city, rec_state) if x) or "Los Angeles CA"
    subtype = (v.get("subtype") or "").replace("_", " ")
    res = tavily(f"{name} {subtype} {hint} contact phone email address".strip())
    if res is None:
        return None  # search failed → signal retry (do not cache)
    results = res.get("results", [])
    want_state = rec_state or "CA"
    tokens = name_tokens(name)

    # Anchor: the first result that yields an in-state street address.
    anchor_text = anchor_addr = None
    for r in results:
        text = (r.get("raw_content") or "") + "\n" + (r.get("content") or "")
        a = pick_address(text)
        if a and a["state"] == want_state:
            # If the record already names a city, it must agree.
            if rec_city and rec_city.lower() not in a["city"].lower() \
               and a["city"].lower() not in rec_city.lower():
                continue
            anchor_text, anchor_addr = text, a
            break
    if not anchor_addr:
        return {}  # no verifiable local match → fill nothing

    out = {}
    for k in ("address", "city", "state", "zip"):
        if not (v.get(k) or "").strip():
            out[k] = anchor_addr[k]

    # Phone: read from the SAME page that carried the anchor address.
    if not (v.get("phone") or "").strip():
        ph = pick_phone(anchor_text)
        if ph:
            out["phone"] = ph

    # Website: a non-directory result whose domain matches the business name.
    if not (v.get("website") or "").strip():
        for r in results:
            u = (r.get("url") or "").split("?")[0].rstrip("/")
            if u.startswith("http") and not is_directory(u) and domain_matches_name(u, tokens):
                out["website"] = u
                break

    # Email: only when its domain matches the confirmed official website.
    if not (v.get("email") or "").strip():
        official_domain = host_of(out.get("website") or v.get("website") or "")
        if official_domain:
            official_text = "\n".join(
                (r.get("raw_content") or "") + "\n" + (r.get("content") or "")
                for r in results if host_of(r.get("url", "")) == official_domain
            )
            em = pick_email(official_text, official_domain)
            if em:
                out["email"] = em
    return out


def missing(v: dict) -> bool:
    return any(not (v.get(f) or "").strip() for f in ENRICH_FIELDS)


def qstr(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", default=".data/_vendors.json")
    ap.add_argument("--subtype", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--emit-only", action="store_true",
                    help="skip searching; emit SQL from the existing cache")
    args = ap.parse_args()

    if not TAVILY_KEY and not args.emit_only:
        log("!! TAVILY_API_KEY not set (source .secrets/enrich.env)")
        sys.exit(1)

    vendors = json.load(open(args.dump))
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

    if not args.emit_only:
        todo = [v for v in vendors if missing(v) and v["id"] not in cache
                and (not args.subtype or (v.get("subtype") or "") == args.subtype)]
        if args.limit:
            todo = todo[: args.limit]
        log(f"tavily-enriching {len(todo)} vendors ({len(cache)} cached)")

        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(enrich, v): v for v in todo}
            for fut in as_completed(futs):
                v = futs[fut]
                done += 1
                try:
                    patch = fut.result()
                except Exception as e:  # noqa: BLE001
                    patch = None
                    log(f"  ! {v['name']}: {e}")
                if patch is None:
                    continue  # search failed → leave uncached for retry
                cache[v["id"]] = patch
                if patch:
                    log(f"  [{done}/{len(todo)}] {v['name']}: "
                        + ", ".join(f"{k}={val}" for k, val in patch.items()))
                if done % 15 == 0:  # checkpoint so a timeout never loses progress
                    json.dump(cache, open(CACHE, "w"), indent=1)
        os.makedirs(".data", exist_ok=True)
        json.dump(cache, open(CACHE, "w"), indent=1)

    # Emit blank-only fills for everything cached.
    by_id = {v["id"]: v for v in vendors}
    print("-- Vendor CRM: Tavily internet enrichment (blank fields only)")
    print("begin;")
    n = fills = 0
    for vid, patch in cache.items():
        v = by_id.get(vid)
        if not v or not patch:
            continue
        sets = []
        for f in ENRICH_FIELDS:
            if (v.get(f) or "").strip():
                continue
            val = patch.get(f)
            if isinstance(val, str) and val.strip():
                sets.append(f"{f} = coalesce({f}, {qstr(val.strip())})")
                fills += 1
        if sets:
            n += 1
            print(f"update greendogops.crm_organization set {', '.join(sets)} where id = '{vid}';")
    print("commit;")
    log(f"SQL: {fills} field fills across {n} vendors")


if __name__ == "__main__":
    main()
