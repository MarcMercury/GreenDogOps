#!/usr/bin/env python3
"""Discover LA-County pet businesses (non-medical) and sync them into Business CRM.

Business CRM = greendogops.crm_organization rows with org_type='marketing_partner'.

Pipeline (mirrors scripts/enrich_vendors.py conventions):

  1. DUMP existing business partners from the DB (name/phone/website/address/
     city/zip/area/subtype) so we can dedup against them.

  2. DISCOVER — for every (zone x category) pair, ask OpenAI's web-search model
     for real, currently-operating, NON-medical pet businesses in that part of
     LA County, returned as structured JSON (name/address/city/zip/phone/
     website/instagram/services). Results cached to .data/_petbiz_cache.json so
     re-runs are cheap.

  3. MATCH — compare each discovered business against existing rows using
     phone (last-10 digits), normalized name, and token overlap. "Use logic and
     reason" => phone match wins; else exact normalized name; else high token
     overlap within the same city/area.

  4. EMIT SQL —
        matches  -> UPDATE ... set col = coalesce(col, <value>)  (never clobber)
        new      -> INSERT new marketing_partner, tagged source=SOURCE_TAG,
                    area derived from city/zip (CITY_TO_ZONE) or the query zone.

Usage:
    set -a; source .secrets/enrich.env; set +a
    python scripts/import_pet_businesses.py --dump-only          # just refresh existing dump
    python scripts/import_pet_businesses.py --limit 3            # small test slice
    python scripts/import_pet_businesses.py > .data/_petbiz_updates.sql
    ./scripts/supabase-sql.sh -f .data/_petbiz_updates.sql
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, ".data")
EXISTING = os.path.join(DATA, "_business_existing.json")
CACHE = os.path.join(DATA, "_petbiz_cache.json")
SQL_HELPER = os.path.join(ROOT, "scripts", "supabase-sql.sh")

SOURCE_TAG = "ai_web_scrape_2026_07"

OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
SEARCH_MODEL = os.environ.get("OPENAI_SEARCH_MODEL", "gpt-4o-mini-search-preview")

# ---------------------------------------------------------------------------
# Geography — zones mirror src/lib/crm/referral-types.ts ZONE_DEFINITIONS.
# Each zone lists the neighborhoods we hand to the search model + the cities we
# map back to the zone when assigning `area` to a brand-new record.
# ---------------------------------------------------------------------------
ZONES: list[dict] = [
    {
        "area": "Westside & Coastal",
        "cities": [
            "Santa Monica", "Venice", "Marina del Rey", "Culver City",
            "Beverly Hills", "Westwood", "Malibu", "Pacific Palisades",
            "Brentwood", "Mar Vista", "Playa del Rey", "Playa Vista",
            "West Los Angeles", "Palms", "Century City",
        ],
    },
    {
        "area": "South Valley",
        "cities": [
            "Studio City", "Sherman Oaks", "Encino", "Tarzana",
            "Woodland Hills", "Burbank", "Toluca Lake", "Universal City",
            "Valley Village", "West Hills",
        ],
    },
    {
        "area": "North Valley",
        "cities": [
            "Northridge", "Chatsworth", "Granada Hills", "Porter Ranch",
            "Van Nuys", "Reseda", "Canoga Park", "North Hollywood",
            "Sun Valley", "Sylmar", "Pacoima", "Mission Hills", "Winnetka",
            "Panorama City", "Arleta",
        ],
    },
    {
        "area": "Central & Eastside",
        "cities": [
            "Downtown Los Angeles", "Silver Lake", "Echo Park", "Hollywood",
            "West Hollywood", "Los Feliz", "Eagle Rock", "Boyle Heights",
            "Atwater Village", "Highland Park", "Mid-City", "Koreatown",
            "Larchmont", "Glassell Park",
        ],
    },
    {
        "area": "South Bay",
        "cities": [
            "El Segundo", "Manhattan Beach", "Torrance", "Redondo Beach",
            "Hawthorne", "Inglewood", "Gardena", "Hermosa Beach", "Lawndale",
            "El Camino Village", "Lomita", "Carson",
        ],
    },
    {
        "area": "San Gabriel Valley",
        "cities": [
            "Pasadena", "Glendale", "Arcadia", "Alhambra", "Monterey Park",
            "San Marino", "South Pasadena", "Montrose", "La Canada Flintridge",
            "Sierra Madre", "Temple City", "San Gabriel", "Monrovia",
        ],
    },
]

# City -> area lookup for assigning `area` on new records from their city.
CITY_TO_ZONE: dict[str, str] = {}
for _z in ZONES:
    for _c in _z["cities"]:
        CITY_TO_ZONE[_c.lower()] = _z["area"]
# A few common aliases / spellings. NOTE: bare "Los Angeles" / "DTLA" are
# intentionally NOT mapped here — they are too generic and would mislabel
# Westside/South Bay/Valley businesses. Those fall back to the query zone
# (which reflects the neighborhood searched + the phone area code).
CITY_TO_ZONE.update({
    "north hills": "North Valley",
    "lake balboa": "North Valley",
    "la canada": "San Gabriel Valley",
    "la crescenta": "San Gabriel Valley",
})

# ---------------------------------------------------------------------------
# Categories -> Business-CRM subtype (values already present in the DB).
# ---------------------------------------------------------------------------
CATEGORIES: list[dict] = [
    {
        "subtype": "groomer",
        "desc": "dog & cat grooming salons and mobile pet grooming",
    },
    {
        "subtype": "pet_business",
        "desc": "dog walkers, pet sitters, and dog trainers / obedience",
    },
    {
        "subtype": "daycare_boarding",
        "desc": "dog daycare, pet boarding, kennels, and pet hotels",
    },
    {
        "subtype": "pet_retail",
        "desc": "pet supply / pet retail stores and pet boutiques",
    },
    {
        "subtype": "food_vendor",
        "desc": "specialty pet nutrition, raw pet food, and natural pet food stores",
    },
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# SQL value quoting (matches enrich_vendors.py qstr semantics).
# ---------------------------------------------------------------------------
def qstr(v) -> str:
    if v is None:
        return "null"
    v = re.sub(r"\s+", " ", str(v)).strip()
    if not v or v.lower() in ("na", "n/a", "none", "null", "unknown"):
        return "null"
    return "'" + v.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# Normalization / matching helpers.
# ---------------------------------------------------------------------------
_LEGAL = re.compile(
    r"\b(inc|inc\.|llc|l\.l\.c\.|co|co\.|corp|ltd|the|and|&)\b", re.IGNORECASE
)
_NONWORD = re.compile(r"[^a-z0-9 ]+")
# Generic pet words removed only when building the *token set* for fuzzy compare
# (kept in the exact-normalized key so distinct brands never collapse).
_GENERIC = {
    "pet", "pets", "dog", "dogs", "cat", "cats", "grooming", "groomer",
    "groomers", "salon", "spa", "mobile", "boarding", "daycare", "kennel",
    "kennels", "supply", "supplies", "store", "shop", "boutique", "care",
    "center", "food", "nutrition", "walking", "walker", "sitting", "sitter",
    "training", "trainer", "la", "los", "angeles", "of",
}


def norm_name(name: str) -> str:
    n = (name or "").lower()
    n = n.replace("'", "").replace("’", "")
    n = _NONWORD.sub(" ", n)
    n = _LEGAL.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def name_tokens(name: str) -> set[str]:
    return {t for t in norm_name(name).split() if t and t not in _GENERIC}


def phone10(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", str(phone))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# ---------------------------------------------------------------------------
# Existing-business dump (via the Supabase Management API helper).
# ---------------------------------------------------------------------------
DUMP_QUERY = (
    "select id, name, subtype, phone, phone_alt, email, website, instagram, "
    "address, city, state, zip, area, services "
    "from greendogops.crm_organization "
    "where org_type = 'marketing_partner' order by name;"
)


def dump_existing() -> list[dict]:
    res = subprocess.run(
        [SQL_HELPER, "-q", DUMP_QUERY],
        capture_output=True, text=True, cwd=ROOT,
    )
    if res.returncode != 0:
        log("!! dump failed:", res.stderr[:400])
        sys.exit(1)
    rows = json.loads(res.stdout)
    os.makedirs(DATA, exist_ok=True)
    json.dump(rows, open(EXISTING, "w"), indent=1)
    log(f"dumped {len(rows)} existing business partners -> {EXISTING}")
    return rows


# ---------------------------------------------------------------------------
# Discovery via OpenAI web-search model.
# ---------------------------------------------------------------------------
DISCOVER_PROMPT = """You are a precise local-business researcher. Using web search, \
find REAL, currently-operating businesses that match this category and area.

Category: {desc}
Area of Los Angeles County: {area}
Focus neighborhoods/cities: {cities}

STRICT RULES:
- Los Angeles County, California ONLY.
- NON-medical only. EXCLUDE veterinary hospitals, veterinary clinics, animal \
hospitals, emergency/urgent vet care, spay/neuter clinics, and anything that \
practices veterinary medicine. Storefront pet retail/grooming/daycare is fine.
- Only businesses you can verify online. Never invent a business, phone, or address.
- Return as many distinct real matches as you can (aim 15-25), no duplicates.

Return ONLY a JSON array (no prose, no code fences). Each element:
{{
  "name": "official business name",
  "address": "street address only, no city/state/zip (null if unknown)",
  "city": "city/neighborhood (null if unknown)",
  "zip": "5-digit ZIP (null if unknown)",
  "phone": "(XXX) XXX-XXXX (null if unknown)",
  "website": "https://... official site (null if none)",
  "instagram": "instagram handle or URL (null if none)",
  "services": "short <=120 char description of what they offer"
}}"""


def discover(area: str, cities: list[str], subtype: str, desc: str) -> list[dict]:
    body = {
        "model": SEARCH_MODEL,
        "messages": [{
            "role": "user",
            "content": DISCOVER_PROMPT.format(
                desc=desc, area=area, cities=", ".join(cities),
            ),
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
        r = urllib.request.urlopen(req, timeout=180)
        d = json.load(r)
    except urllib.error.HTTPError as e:
        log(f"  ! HTTP {e.code} [{area}/{subtype}]: {e.read().decode()[:160]}")
        return []
    except Exception as e:  # noqa: BLE001
        log(f"  ! error [{area}/{subtype}]: {e}")
        return []

    content = d["choices"][0]["message"]["content"]
    m = re.search(r"\[.*\]", content, re.DOTALL)
    if not m:
        log(f"  ? no json array [{area}/{subtype}]")
        return []
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        log(f"  ? bad json [{area}/{subtype}]")
        return []
    out = []
    if isinstance(arr, list):
        for it in arr:
            if isinstance(it, dict) and (it.get("name") or "").strip():
                it["_area"] = area
                it["_subtype"] = subtype
                out.append(it)
    return out


# ---------------------------------------------------------------------------
# Area assignment for a new record.
# ---------------------------------------------------------------------------
def area_for(city: str | None, zip_code: str | None, fallback: str) -> str:
    if city:
        z = CITY_TO_ZONE.get(city.strip().lower())
        if z:
            return z
    return fallback


def clean(v) -> str | None:
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    if not s or s.lower() in ("na", "n/a", "none", "null", "unknown"):
        return None
    return s


# ---------------------------------------------------------------------------
# Match a discovered business against the existing set.
# ---------------------------------------------------------------------------
def build_index(existing: list[dict]):
    by_phone: dict[str, dict] = {}
    by_norm: dict[str, dict] = {}
    for e in existing:
        p = phone10(e.get("phone")) or phone10(e.get("phone_alt"))
        if p:
            by_phone.setdefault(p, e)
        nk = norm_name(e.get("name"))
        if nk:
            by_norm.setdefault(nk, e)
        e["_tokens"] = name_tokens(e.get("name"))
    return by_phone, by_norm


def find_match(cand: dict, existing: list[dict], by_phone, by_norm) -> dict | None:
    p = phone10(cand.get("phone"))
    if p and p in by_phone:
        return by_phone[p]
    nk = norm_name(cand.get("name"))
    if nk and nk in by_norm:
        return by_norm[nk]
    # Fuzzy: high token overlap within same city or area.
    ctoks = name_tokens(cand.get("name"))
    ccity = (clean(cand.get("city")) or "").lower()
    carea = cand.get("_area")
    best, best_score = None, 0.0
    for e in existing:
        score = jaccard(ctoks, e["_tokens"])
        if score < 0.8:
            continue
        same_place = (
            (ccity and (clean(e.get("city")) or "").lower() == ccity)
            or (e.get("area") == carea)
        )
        if same_place and score > best_score:
            best, best_score = e, score
    return best


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
FILL_FIELDS = [
    "phone", "email", "website", "instagram", "address", "city", "state",
    "zip", "services",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0,
                    help="cap number of (zone x category) discovery calls")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--refresh", action="store_true",
                    help="ignore cache, re-run discovery")
    args = ap.parse_args()

    existing = dump_existing()
    if args.dump_only:
        return

    if not OPENAI_KEY:
        log("!! OPENAI_API_KEY not set — source .secrets/enrich.env")
        sys.exit(1)

    # Discovery jobs = every (zone x category) pair.
    jobs = [
        (z["area"], z["cities"], c["subtype"], c["desc"])
        for z in ZONES for c in CATEGORIES
    ]
    if args.limit:
        jobs = jobs[: args.limit]

    cache: dict[str, list[dict]] = {}
    if os.path.exists(CACHE) and not args.refresh:
        cache = json.load(open(CACHE))

    todo = [j for j in jobs if f"{j[0]}::{j[2]}" not in cache]
    log(f"discovery: {len(jobs)} zone×category jobs, {len(todo)} to fetch, "
        f"{len(cache)} cached, via {SEARCH_MODEL}")

    if todo:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {
                ex.submit(discover, area, cities, sub, desc): (area, sub)
                for (area, cities, sub, desc) in todo
            }
            done = 0
            for fut in as_completed(futs):
                area, sub = futs[fut]
                rows = fut.result()
                done += 1
                cache[f"{area}::{sub}"] = rows
                log(f"  [{done}/{len(todo)}] {area} / {sub}: {len(rows)} found")
        os.makedirs(DATA, exist_ok=True)
        json.dump(cache, open(CACHE, "w"), indent=1)
        log(f"cache saved ({len(cache)} zone×category entries)")

    # Flatten candidates.
    candidates: list[dict] = []
    for rows in cache.values():
        candidates.extend(rows)
    log(f"{len(candidates)} raw candidates")

    by_phone, by_norm = build_index(existing)

    # Dedup candidates against each other (phone, then normalized name).
    seen_phone: set[str] = set()
    seen_norm: set[str] = set()
    updates: dict[str, dict] = {}      # existing.id -> patch
    inserts: list[dict] = []
    matched, new_count, dup = 0, 0, 0

    for c in candidates:
        name = clean(c.get("name"))
        if not name:
            continue
        p = phone10(c.get("phone"))
        nk = norm_name(name)
        # collapse duplicate candidates
        if p and p in seen_phone:
            dup += 1
            # still let it enrich an existing match below? skip to avoid noise
            continue
        if not p and nk in seen_norm:
            dup += 1
            continue

        match = find_match(c, existing, by_phone, by_norm)
        if match and match.get("id") is None:
            # Duplicate of a business we already queued to INSERT this run.
            # Fill any fields still missing on that pending insert, don't UPDATE.
            dup += 1
            ins = match.get("_insert")
            if ins:
                for f in FILL_FIELDS:
                    if not ins.get(f):
                        val = clean(c.get(f))
                        if val:
                            ins[f] = val
            continue
        if match:
            matched += 1
            patch = updates.setdefault(match["id"], {})
            for f in FILL_FIELDS:
                if clean(match.get(f)):
                    continue  # never clobber existing
                val = clean(c.get(f))
                if val and f not in patch:
                    patch[f] = val
            # backfill area if the existing row has none
            if not clean(match.get("area")):
                patch.setdefault(
                    "area", area_for(c.get("city"), c.get("zip"), c["_area"])
                )
        else:
            new_count += 1
            ins = {
                "name": name,
                "subtype": c["_subtype"],
                "phone": clean(c.get("phone")),
                "email": clean(c.get("email")),
                "website": clean(c.get("website")),
                "instagram": clean(c.get("instagram")),
                "address": clean(c.get("address")),
                "city": clean(c.get("city")),
                "state": clean(c.get("state")) or "CA",
                "zip": clean(c.get("zip")),
                "services": clean(c.get("services")),
                "area": area_for(c.get("city"), c.get("zip"), c["_area"]),
            }
            inserts.append(ins)
            # register so later candidates dedup against this new one too
            placeholder = {
                "id": None, "name": name,
                "_tokens": name_tokens(name), "_insert": ins,
            }
            if p:
                by_phone[p] = placeholder
            by_norm[nk] = placeholder

        if p:
            seen_phone.add(p)
        seen_norm.add(nk)

    # Drop empty update patches.
    updates = {k: v for k, v in updates.items() if v}

    # --- emit SQL ---
    print("-- Business CRM: LA-County pet-business web scrape (non-medical)")
    print("-- generated by scripts/import_pet_businesses.py")
    print(f"-- source tag: {SOURCE_TAG}")
    print("begin;")

    for oid, patch in updates.items():
        if not oid or oid == "None":
            continue
        sets = [f"{f} = coalesce({f}, {qstr(v)})" for f, v in patch.items()]
        sets.append("updated_at = now()")
        print(
            f"update greendogops.crm_organization set {', '.join(sets)} "
            f"where id = '{oid}';"
        )

    cols = [
        "org_type", "name", "subtype", "status", "phone", "email", "website",
        "instagram", "address", "city", "state", "zip", "area", "services",
        "is_active", "source",
    ]
    for r in inserts:
        vals = [
            qstr("marketing_partner"), qstr(r["name"]), qstr(r["subtype"]),
            qstr("prospect"), qstr(r["phone"]), qstr(r["email"]),
            qstr(r["website"]), qstr(r["instagram"]), qstr(r["address"]),
            qstr(r["city"]), qstr(r["state"]), qstr(r["zip"]), qstr(r["area"]),
            qstr(r["services"]), "true", qstr(SOURCE_TAG),
        ]
        print(
            f"insert into greendogops.crm_organization ({', '.join(cols)}) "
            f"values ({', '.join(vals)});"
        )

    print("commit;")
    log(f"SQL: {len(updates)} updates, {len(inserts)} inserts "
        f"(matched={matched}, new={new_count}, dup-candidates={dup})")


if __name__ == "__main__":
    main()
