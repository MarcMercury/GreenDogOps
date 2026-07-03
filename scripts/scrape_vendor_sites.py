#!/usr/bin/env python3
"""Scrape a vendor's OWN website to fill blank contact fields (no paid API).

For every greendogops.crm_organization row (in the Vendor & Partner directory)
that already has a `website` but is missing phone / email / address, this fetches
the homepage plus a couple of likely contact pages and extracts:
  * email   — first public mailto/contact email that isn't an asset/placeholder
  * phone   — first plausible US phone, normalized to (XXX) XXX-XXXX
  * address / city / state / zip — parsed from a "street, City, ST 12345" block

Only currently-blank columns are filled (emitted as `coalesce(col, '...')`), so
existing data is never replaced. Output = SQL UPDATE statements to stdout;
progress/log to stderr.

Usage:
    python scripts/scrape_vendor_sites.py --dump .data/_vendors.json          > .data/_site_fills.sql
    python scripts/scrape_vendor_sites.py --dump .data/_vendors.json --subtype rescue > out.sql
    python scripts/scrape_vendor_sites.py --dump .data/_vendors.json --limit 20 > out.sql
    ./scripts/supabase-sql.sh -f .data/_site_fills.sql
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = (
    "Mozilla/5.0 (compatible; GreenDogOps-Enrich/1.0; +https://greendogdental.com)"
)
FILL_FIELDS = ("phone", "email", "address", "city", "state", "zip")

STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)")
# "123 Main St[, Suite 4], City, ST 90210"
ADDR_RE = re.compile(
    r"(\d{1,6}\s+[A-Za-z0-9 .,'#\-]{3,60}?),\s*([A-Za-z .'\-]{2,40}),\s*([A-Z]{2})\.?\s+(\d{5})(?:-\d{4})?"
)

BAD_EMAIL_HINT = re.compile(r"(sentry|example\.com|\.png|\.jpg|\.jpeg|\.gif|\.svg|@2x|wixpress|godaddy|domain\.com|email@|yourname|@sentry)", re.I)
CONTACT_PATHS = ("", "contact", "contact-us", "contactus", "about", "about-us", "adopt")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def norm_url(w: str) -> str | None:
    w = (w or "").strip()
    if not w:
        return None
    if not re.match(r"^https?://", w, re.I):
        w = "https://" + w
    return w.rstrip("/")


def fetch(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(1_500_000)
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return raw.decode("utf-8", "ignore")


def strip_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    # Decode numeric HTML entities (some sites obfuscate emails this way).
    text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    text = (text.replace("&amp;", "&").replace("&nbsp;", " ")
                .replace("&#39;", "'").replace("&apos;", "'"))
    return re.sub(r"[ \t\r\f\v]+", " ", text)


# A fully-valid email (used to reject encoded/garbled candidates).
STRICT_EMAIL = re.compile(r"^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9.\-]+\.[a-z]{2,}$")


def pick_email(html: str, text: str, domain: str) -> str | None:
    cands: list[str] = []
    for m in re.finditer(r"mailto:([^\"'?>\s]+)", html, re.I):
        cands.append(m.group(1))
    cands += EMAIL_RE.findall(text)
    seen, clean = set(), []
    for e in cands:
        e = urllib.parse.unquote(e.strip()).strip().strip(".").lower()
        if e in seen or BAD_EMAIL_HINT.search(e) or not STRICT_EMAIL.match(e):
            continue
        seen.add(e)
        clean.append(e)
    if not clean:
        return None
    # prefer same-domain, then info@/contact@/adopt@/hello@
    dom = domain.lstrip("www.")
    for pref in (lambda e: e.endswith("@" + dom),
                 lambda e: re.match(r"(info|contact|adopt|hello|admin|office|sales)@", e)):
        for e in clean:
            if pref(e):
                return e
    return clean[0]


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


def scrape(v: dict) -> dict:
    base = norm_url(v.get("website"))
    if not base:
        return {}
    domain = re.sub(r"^https?://", "", base).split("/")[0]
    want_addr = not (v.get("address") or "").strip()
    email = phone = None
    addr = None
    for path in CONTACT_PATHS:
        url = base if path == "" else f"{base}/{path}"
        try:
            html = fetch(url)
        except Exception:
            continue
        text = strip_html(html)
        if email is None:
            email = pick_email(html, text, domain)
        if phone is None:
            phone = pick_phone(text)
        if want_addr and addr is None:
            addr = pick_address(text)
        if email and phone and (addr or not want_addr):
            break
    out = {}
    if not (v.get("email") or "").strip() and email:
        out["email"] = email
    if not (v.get("phone") or "").strip() and phone:
        out["phone"] = phone
    if addr:
        for k in ("address", "city", "state", "zip"):
            if not (v.get(k) or "").strip():
                out[k] = addr[k]
    return out


def qstr(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", default=".data/_vendors.json")
    ap.add_argument("--subtype", default="", help="only this subtype (e.g. rescue)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    vendors = json.load(open(args.dump))
    todo = [
        v for v in vendors
        if (v.get("website") or "").strip()
        and any(not (v.get(f) or "").strip() for f in ("phone", "email", "address"))
        and (not args.subtype or (v.get("subtype") or "") == args.subtype)
    ]
    if args.limit:
        todo = todo[: args.limit]
    log(f"scraping {len(todo)} sites (workers={args.workers})")

    fills = {}
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(scrape, v): v for v in todo}
        for fut in as_completed(futs):
            v = futs[fut]
            done += 1
            try:
                patch = fut.result()
            except Exception as e:  # noqa: BLE001
                patch = {}
                log(f"  [{done}/{len(todo)}] {v['name']}: error {e}")
            if patch:
                fills[v["id"]] = patch
                log(f"  [{done}/{len(todo)}] {v['name']}: "
                    + ", ".join(f"{k}={val}" for k, val in patch.items()))

    print("-- Vendor CRM: website-scrape contact fills (blank fields only)")
    print("-- generated by scripts/scrape_vendor_sites.py")
    print("begin;")
    n = 0
    for vid, patch in fills.items():
        sets = ", ".join(f"{k} = coalesce({k}, {qstr(val)})" for k, val in patch.items())
        n += len(patch)
        print(f"update greendogops.crm_organization set {sets} where id = '{vid}';")
    print("commit;")
    log(f"SQL: {n} field fills across {len(fills)} vendors")


if __name__ == "__main__":
    main()
