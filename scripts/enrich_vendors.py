#!/usr/bin/env python3
"""Reclassify Vendor-CRM organizations into 3 types and AI-enrich missing fields.

Vendor CRM = greendogops.crm_organization rows with org_type in
(med_ops, facility_resource, office_marketing).

This script does two things:

  1. TYPE CLASSIFICATION (deterministic, reviewable) — buckets every vendor into
     one of three "types":
        med_ops          : clinical / medical operations (labs, pharma, dental
                           instruments, diagnostics, PIMS, distributors, assns)
        facility_resource: building & grounds (plumbers, handymen, hvac, ...)
        office_marketing : office supplies, printing, signage, shipping, uniforms,
                           retail, media, client-comm / payment / marketing tools
     Facility rows stay facility; med_ops rows may move to office_marketing based
     on subtype + name keywords. (See classify().)

  2. AI INTERNET ENRICHMENT — for every vendor that is missing public details
     (website / phone / email / address / city / state / zip / a one-line
     services description) it asks OpenAI's web-search model to look the company
     up online and return verified facts as JSON. Only NULL columns are filled
     (coalesce — never clobbers existing data). Results are cached to
     .data/_vendor_enrich_cache.json so re-runs are cheap.

Output: SQL UPDATE statements to stdout (progress/log go to stderr).

Usage:
    set -a; source .secrets/enrich.env; set +a
    python scripts/enrich_vendors.py            > .data/_vendor_updates.sql
    python scripts/enrich_vendors.py --no-ai    > .data/_vendor_updates.sql   # classify only
    python scripts/enrich_vendors.py --limit 20 > .data/_vendor_updates.sql   # test slice
    ./scripts/supabase-sql.sh -f .data/_vendor_updates.sql
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DATA = ".data"
DUMP = f"{DATA}/_vendors.json"
CACHE = f"{DATA}/_vendor_enrich_cache.json"

OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
SEARCH_MODEL = os.environ.get("OPENAI_SEARCH_MODEL", "gpt-4o-mini-search-preview")

# Columns the AI is allowed to fill (text only; only filled when currently NULL).
ENRICH_FIELDS = [
    "website", "phone", "email", "address", "city", "state", "zip", "services",
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def qstr(v):
    if v is None:
        return "null"
    v = re.sub(r"\s+", " ", str(v)).strip()
    if not v or v.lower() in ("na", "n/a", "none", "null", "unknown"):
        return "null"
    return "'" + v.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# 1. Deterministic type classification
# ---------------------------------------------------------------------------
# Whole subtypes that belong in the marketing/office bucket.
OFFICE_SUBTYPES = {
    "printing",
    "office supply",
    "industry media",
    "retail",
    "client communication & payment",
}

# Name keywords that signal marketing / office (checked on med_ops rows only).
OFFICE_KEYWORDS = [
    "print", "sign", "graphic", "uniform", "unifirst", "fedex", "usps",
    "postage", "copier", "toner", "amazon", "ebay", "costco", "staples",
    "target gdd", "walmart", "office", "ready refresh", "sparkletts", "flower",
    "carecredit", "scratchpay", "petdesk", "weave", "review tree", "vet growth",
    "marketing", "otto", "copy hub", "copyhub", "uprint", "staedtler",
    "discovers",
]

# Standalone-word signals (avoid substring false positives like "groups").
OFFICE_WORDS = {"ups", "rxpads", "mail"}


def classify(name: str, subtype: str | None, current: str) -> str:
    """Return one of: med_ops | facility_resource | office_marketing."""
    # Building / grounds vendors always remain facility.
    if current == "facility_resource":
        return "facility_resource"

    s = (subtype or "").strip().lower()
    if s in OFFICE_SUBTYPES:
        return "office_marketing"

    n = (name or "").lower()
    for kw in OFFICE_KEYWORDS:
        if kw in n:
            return "office_marketing"
    words = set(re.findall(r"[a-z0-9]+", n))
    if words & OFFICE_WORDS:
        return "office_marketing"

    return "med_ops"


# ---------------------------------------------------------------------------
# 2. AI internet enrichment
# ---------------------------------------------------------------------------
# Vendors where a web lookup is pointless / would only add noise.
SKIP_ENRICH_SUBTYPES = {
    "facebook group", "alumni group", "veterinary board",
    "veterinary association", "conference / ce",
}


def missing_fields(v: dict) -> list[str]:
    return [f for f in ENRICH_FIELDS if not (v.get(f) or "").strip()]


def should_enrich(v: dict) -> bool:
    if (v.get("subtype") or "").strip().lower() in SKIP_ENRICH_SUBTYPES:
        return False
    return bool(missing_fields(v))


PROMPT = """You are a precise B2B data-enrichment researcher. Search the web for the \
real company/vendor below and return ONLY verified public business-directory facts.

Vendor name: {name}
Known so far: {known}
Context (internal notes/category): {ctx}

Return a single JSON object with EXACTLY these keys (use null when you cannot find \
a confident, verifiable value — never guess or invent):
  "website"  : official homepage URL (https://...), null if none
  "phone"    : main public phone in (XXX) XXX-XXXX form, null if unknown
  "email"    : public contact/sales email, null if unknown
  "address"  : street address (no city/state/zip), null if unknown
  "city"     : null if unknown
  "state"    : 2-letter US state code, null if unknown
  "zip"      : 5-digit, null if unknown
  "services" : one short sentence (<=140 chars) describing what they sell/do

Only return facts you can verify online for THIS specific vendor. If the vendor is a \
national brand (Amazon, FedEx, Costco, IDEXX, etc.) give its corporate website + main \
line and leave local address fields null. Output JSON only, no prose, no code fences."""


def openai_lookup(v: dict) -> dict | None:
    known = ", ".join(
        f"{k}={v[k]}" for k in ("website", "city", "state", "phone")
        if (v.get(k) or "").strip()
    ) or "nothing"
    ctx = " | ".join(
        str(v[k]) for k in ("subtype", "services", "area", "notes")
        if (v.get(k) or "").strip()
    )[:400] or "none"
    body = {
        "model": SEARCH_MODEL,
        "messages": [{
            "role": "user",
            "content": PROMPT.format(name=v["name"], known=known, ctx=ctx),
        }],
        "web_search_options": {},
    }
    req = urllib.request.Request(
        f"{OPENAI_BASE}/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {OPENAI_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=90)
        d = json.load(r)
    except urllib.error.HTTPError as e:
        log(f"  ! HTTP {e.code} for {v['name']}: {e.read().decode()[:160]}")
        return None
    except Exception as e:  # noqa: BLE001
        log(f"  ! error for {v['name']}: {e}")
        return None

    content = d["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if not m:
        log(f"  ? no json from model for {v['name']}")
        return None
    try:
        out = json.loads(m.group(0))
    except json.JSONDecodeError:
        log(f"  ? bad json for {v['name']}")
        return None
    return out if isinstance(out, dict) else None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ai", action="store_true", help="classification only")
    ap.add_argument("--no-reclass", action="store_true",
                    help="never change org_type; only fill blank fields")
    ap.add_argument("--limit", type=int, default=0, help="cap AI lookups (test)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    vendors = json.load(open(DUMP))
    log(f"loaded {len(vendors)} vendors")

    # --- type classification + summary ---
    moves = {"med_ops": 0, "facility_resource": 0, "office_marketing": 0}
    reclassified = 0
    for v in vendors:
        new = classify(v["name"], v.get("subtype"), v["org_type"])
        v["_new_type"] = new
        moves[new] += 1
        if new != v["org_type"]:
            reclassified += 1
    log(f"classification -> med_ops {moves['med_ops']}, "
        f"facility {moves['facility_resource']}, "
        f"office_marketing {moves['office_marketing']} "
        f"({reclassified} reclassified)")

    # --- AI enrichment (cached) ---
    cache = {}
    if os.path.exists(CACHE):
        cache = json.load(open(CACHE))
    enriched = {}

    if not args.no_ai:
        if not OPENAI_KEY:
            log("!! OPENAI_API_KEY not set — skipping enrichment "
                "(source .secrets/enrich.env)")
        else:
            todo = [v for v in vendors if should_enrich(v) and v["id"] not in cache]
            if args.limit:
                todo = todo[: args.limit]
            log(f"enriching {len(todo)} vendors "
                f"({len(cache)} already cached) via {SEARCH_MODEL}")
            done = 0
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                futs = {ex.submit(openai_lookup, v): v for v in todo}
                for fut in as_completed(futs):
                    v = futs[fut]
                    res = fut.result()
                    done += 1
                    if res:
                        cache[v["id"]] = res
                        log(f"  [{done}/{len(todo)}] {v['name']}: "
                            f"{', '.join(k for k, val in res.items() if val) or '—'}")
                    else:
                        log(f"  [{done}/{len(todo)}] {v['name']}: no data")
            json.dump(cache, open(CACHE, "w"), indent=1)
            log(f"cache saved ({len(cache)} entries)")

    # merge cache -> only fill fields that are currently NULL on the vendor
    for v in vendors:
        res = cache.get(v["id"])
        if not res:
            continue
        patch = {}
        for f in ENRICH_FIELDS:
            if (v.get(f) or "").strip():
                continue  # never clobber existing
            val = res.get(f)
            if isinstance(val, str) and val.strip() and val.strip().lower() not in (
                "null", "none", "n/a", "unknown",
            ):
                patch[f] = val.strip()
        if patch:
            enriched[v["id"]] = patch

    # --- emit SQL ---
    print("-- Vendor CRM: type reclassification + AI internet enrichment")
    print("-- generated by scripts/enrich_vendors.py")
    print("begin;")
    type_changes = 0
    fill_count = 0
    for v in vendors:
        sets = []
        if v["_new_type"] != v["org_type"] and not args.no_reclass:
            sets.append(f"org_type = {qstr(v['_new_type'])}")
            type_changes += 1
        patch = enriched.get(v["id"], {})
        for f, val in patch.items():
            # coalesce guard: only set when still null (idempotent + safe)
            sets.append(f"{f} = coalesce({f}, {qstr(val)})")
            fill_count += 1
        if not sets:
            continue
        print(
            f"update greendogops.crm_organization set {', '.join(sets)} "
            f"where id = '{v['id']}';"
        )
    print("commit;")
    log(f"SQL: {type_changes} type changes, {fill_count} field fills "
        f"across {len(enriched)} vendors")


if __name__ == "__main__":
    main()
