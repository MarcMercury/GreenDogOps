#!/usr/bin/env python3
"""Fill missing key fields for Referral CRM partners via the Google Places API.

Why Places: for physical clinics, Google Places returns authoritative
`formatted_address`, `formatted_phone_number`, and `website` — no scraping,
no guessing. We resolve each clinic with Text Search (name + "Los Angeles CA"),
then fetch Place Details for the top match.

Fields filled (only when currently blank):
- address  : Place Details `formatted_address`
- phone    : Place Details `formatted_phone_number` (national format)
- website  : Place Details `website`
- zone     : inferred from the resolved address (zip → zone, then city → zone),
             using the same maps derived from already-zoned partners plus the
             canonical zone city lists.
- clinic_type : heuristic from the clinic name when blank.

Note: Places does NOT return a "primary contact" person, so `contact_name`
is intentionally left for a separate people-lookup step.

Requires: GOOGLE_MAPS_API_KEY (or GOOGLE_PLACES_API_KEY) with the "Places API"
enabled and billing active. Read via .secrets/enrich.env.

Usage:
  set -a; source .secrets/enrich.env; source .secrets/supabase.env; set +a
  python scripts/enrich_referral_places.py --limit 50 > .data/_referral_places_updates.sql
  ./scripts/supabase-sql.sh -f .data/_referral_places_updates.sql
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from typing import Any

PLACES_KEY = os.environ.get("GOOGLE_MAPS_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY", "")
TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"

ZONE_DEFS = [
    "Westside & Coastal",
    "South Valley",
    "North Valley",
    "Central & Eastside",
    "South Bay",
    "San Gabriel Valley",
]

# Canonical city → zone (mirrors ZONE_DEFINITIONS in src/lib/crm/referral-types.ts).
CITY_ZONE = {
    # Westside & Coastal
    "santa monica": "Westside & Coastal", "venice": "Westside & Coastal",
    "marina del rey": "Westside & Coastal", "culver city": "Westside & Coastal",
    "beverly hills": "Westside & Coastal", "westwood": "Westside & Coastal",
    "malibu": "Westside & Coastal", "pacific palisades": "Westside & Coastal",
    "brentwood": "Westside & Coastal", "mar vista": "Westside & Coastal",
    # South Valley
    "studio city": "South Valley", "sherman oaks": "South Valley",
    "encino": "South Valley", "tarzana": "South Valley",
    "woodland hills": "South Valley", "burbank": "South Valley",
    "toluca lake": "South Valley", "universal city": "South Valley",
    "calabasas": "South Valley", "valley village": "South Valley",
    "westlake village": "South Valley", "agoura hills": "South Valley",
    # North Valley
    "northridge": "North Valley", "chatsworth": "North Valley",
    "granada hills": "North Valley", "porter ranch": "North Valley",
    "van nuys": "North Valley", "reseda": "North Valley",
    "canoga park": "North Valley", "north hollywood": "North Valley",
    "sun valley": "North Valley", "sylmar": "North Valley",
    "north hills": "North Valley", "winnetka": "North Valley",
    # Central & Eastside
    "silver lake": "Central & Eastside", "echo park": "Central & Eastside",
    "hollywood": "Central & Eastside", "west hollywood": "Central & Eastside",
    "los feliz": "Central & Eastside", "eagle rock": "Central & Eastside",
    "boyle heights": "Central & Eastside", "atwater village": "Central & Eastside",
    # South Bay
    "el segundo": "South Bay", "manhattan beach": "South Bay",
    "torrance": "South Bay", "redondo beach": "South Bay",
    "hawthorne": "South Bay", "inglewood": "South Bay",
    "gardena": "South Bay", "long beach": "South Bay",
    # San Gabriel Valley
    "pasadena": "San Gabriel Valley", "glendale": "San Gabriel Valley",
    "arcadia": "San Gabriel Valley", "alhambra": "San Gabriel Valley",
    "monterey park": "San Gabriel Valley", "san marino": "San Gabriel Valley",
    "south pasadena": "San Gabriel Valley", "altadena": "San Gabriel Valley",
}

ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")
CITY_CA_RE = re.compile(r",\s*([A-Za-z .'-]{2,50}),\s*(?:CA|California)\b", re.I)


def eprint(*a: Any) -> None:
    print(*a, file=sys.stderr, flush=True)


def q(s: str | None) -> str:
    if s is None:
        return "null"
    return "'" + s.replace("'", "''") + "'"


def clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = str(s).strip()
    return s if s else None


def is_blank(v: Any) -> bool:
    return clean(v) is None


def supabase_sql(query: str) -> list[dict[str, Any]]:
    proc = subprocess.run(
        ["./scripts/supabase-sql.sh", "-q", query],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    return payload if isinstance(payload, list) else []


def _get(url: str, params: dict[str, str]) -> dict[str, Any] | None:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(full, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            eprint(f"  ! HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:160]}")
            return None
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                eprint(f"  ! error: {e}")
                return None
            time.sleep(1.0 * (attempt + 1))
    return None


def places_text_search(query: str) -> str | None:
    data = _get(TEXTSEARCH_URL, {"query": query, "region": "us", "key": PLACES_KEY})
    if not data:
        return None
    status = data.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        eprint(f"  ! textsearch status={status} {data.get('error_message','')}")
        return None
    results = data.get("results", [])
    return results[0].get("place_id") if results else None


def place_details(place_id: str) -> dict[str, Any] | None:
    data = _get(
        DETAILS_URL,
        {
            "place_id": place_id,
            "fields": "formatted_address,formatted_phone_number,website,name,business_status",
            "key": PLACES_KEY,
        },
    )
    if not data:
        return None
    if data.get("status") != "OK":
        eprint(f"  ! details status={data.get('status')} {data.get('error_message','')}")
        return None
    return data.get("result", {})


def extract_city(address: str | None) -> str | None:
    s = clean(address)
    if not s:
        return None
    m = CITY_CA_RE.search(s)
    return m.group(1).strip() if m else None


def extract_zip(address: str | None) -> str | None:
    s = clean(address)
    if not s:
        return None
    m = ZIP_RE.search(s)
    return m.group(1) if m else None


def build_zip_zone_map(rows: list[dict[str, Any]]) -> dict[str, str]:
    by_zip: dict[str, Counter[str]] = defaultdict(Counter)
    for r in rows:
        zone = clean(r.get("zone"))
        addr = clean(r.get("address"))
        if not zone or zone not in ZONE_DEFS or not addr:
            continue
        z = extract_zip(addr)
        if z:
            by_zip[z][zone] += 1
    return {k: v.most_common(1)[0][0] for k, v in by_zip.items() if v}


def infer_zone(address: str | None, zip_zone: dict[str, str]) -> str | None:
    z = extract_zip(address)
    if z and z in zip_zone:
        return zip_zone[z]
    c = extract_city(address)
    if c and c.lower() in CITY_ZONE:
        return CITY_ZONE[c.lower()]
    return None


def pick_clinic_type(name: str) -> str:
    n = (name or "").lower()
    if "emergency" in n:
        return "emergency"
    if "special" in n:
        return "specialty"
    if "urgent" in n:
        return "urgent_care"
    if "mobile" in n:
        return "mobile"
    if "shelter" in n:
        return "shelter"
    return "general"


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich incomplete referral partners via Google Places")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N incomplete rows")
    parser.add_argument("--sleep", type=float, default=0.15, help="Delay between clinics")
    args = parser.parse_args()

    if not PLACES_KEY:
        eprint("GOOGLE_MAPS_API_KEY / GOOGLE_PLACES_API_KEY not set (add to .secrets/enrich.env)")
        return 1

    rows = supabase_sql(
        """
        select id, name, hospital_name, address, email, phone, contact_name, contact_person, clinic_type, zone, website
        from greendogops.referral_partners
        order by coalesce(name, hospital_name) asc nulls last
        """
    )

    # Places can fill address / phone / website / zone / clinic_type.
    incomplete = [
        r
        for r in rows
        if is_blank(r.get("address"))
        or is_blank(r.get("phone"))
        or is_blank(r.get("website"))
        or is_blank(r.get("zone"))
        or is_blank(r.get("clinic_type"))
    ]
    if args.limit > 0:
        incomplete = incomplete[: args.limit]

    zip_zone = build_zip_zone_map(rows)
    updates: list[tuple[str, dict[str, str]]] = []

    for idx, row in enumerate(incomplete, start=1):
        name = clean(row.get("name")) or clean(row.get("hospital_name"))
        if not name:
            continue

        patch: dict[str, str] = {}

        needs_places = (
            is_blank(row.get("address"))
            or is_blank(row.get("phone"))
            or is_blank(row.get("website"))
        )

        details: dict[str, Any] = {}
        if needs_places:
            # Anchor the search with any existing address so we hit the right branch.
            hint = clean(row.get("address")) or "Los Angeles CA"
            place_id = places_text_search(f"{name} veterinary {hint}")
            if not place_id:
                place_id = places_text_search(f"{name} Los Angeles CA")
            if place_id:
                details = place_details(place_id) or {}

        if is_blank(row.get("address")) and clean(details.get("formatted_address")):
            addr = clean(details["formatted_address"])
            # Drop the trailing ", USA" Google appends.
            addr = re.sub(r",\s*USA$", "", addr or "")
            patch["address"] = addr

        if is_blank(row.get("phone")) and clean(details.get("formatted_phone_number")):
            patch["phone"] = clean(details["formatted_phone_number"])

        if is_blank(row.get("website")) and clean(details.get("website")):
            site = clean(details["website"]) or ""
            # Drop tracking query strings / fragments Google appends to GMB links.
            site = re.sub(r"[?#].*$", "", site)
            patch["website"] = site or clean(details["website"])

        # Zone from best-known address (new one if just fetched, else existing).
        if is_blank(row.get("zone")):
            zone = infer_zone(patch.get("address") or clean(row.get("address")), zip_zone)
            if zone:
                patch["zone"] = zone

        if is_blank(row.get("clinic_type")):
            patch["clinic_type"] = pick_clinic_type(name)

        if not patch:
            continue

        updates.append((row["id"], patch))
        eprint(f"[{idx}/{len(incomplete)}] {name}: +{', '.join(sorted(patch.keys()))}")
        time.sleep(max(0.0, args.sleep))

    print("-- Referral CRM: incomplete record enrichment (Google Places)")
    print("-- Generated by scripts/enrich_referral_places.py")
    print("begin;")
    for row_id, patch in updates:
        sets = []
        for col in ("address", "phone", "website", "zone", "clinic_type"):
            if col not in patch:
                continue
            sets.append(f"{col} = coalesce(nullif(trim({col}), ''), {q(patch[col])})")
        if not sets:
            continue
        sets.append("updated_at = now()")
        print(f"update greendogops.referral_partners set {', '.join(sets)} where id = {q(row_id)};")
    print("commit;")
    eprint(f"prepared {len(updates)} updates out of {len(incomplete)} incomplete rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
