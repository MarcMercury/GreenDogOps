#!/usr/bin/env python3
"""Assign a CRM Area (geographic zone) to records from their address.

Uses the six "basic areas already created" (ZONE_DEFINITIONS in
src/lib/crm/referral-types.ts). A record is assigned by matching its city (and,
for the ambiguous city "Los Angeles", its ZIP) to a zone. Out-of-state records
become "Online/Remote/Out of Area". Only records with a BLANK area are touched,
and the SQL uses coalesce so existing areas are never overwritten. Records that
can't be confidently placed are left blank (no guessing).

    python scripts/assign_areas.py --dump .data/_vendors.json > .data/_area_fills.sql
    ./scripts/supabase-sql.sh -f .data/_area_fills.sql
"""
from __future__ import annotations

import argparse
import json
import re
import sys

WESTSIDE = "Westside & Coastal"
SOUTH_VALLEY = "South Valley"
NORTH_VALLEY = "North Valley"
CENTRAL = "Central & Eastside"
SOUTH_BAY = "South Bay"
SGV = "San Gabriel Valley"
REMOTE = "Online/Remote/Out of Area"

# --- city -> zone (specific cities / neighborhoods; excludes bare "Los Angeles") ---
CITY_ZONE = {z: zone for zone, cities in {
    WESTSIDE: ["santa monica", "venice", "marina del rey", "culver city",
               "beverly hills", "westwood", "malibu", "pacific palisades",
               "brentwood", "playa vista", "playa del rey", "mar vista",
               "del rey", "west la", "west los angeles", "century city",
               "bel air", "sawtelle", "palms", "westchester"],
    SOUTH_VALLEY: ["studio city", "sherman oaks", "encino", "tarzana",
                   "woodland hills", "burbank", "toluca lake", "universal city",
                   "valley village", "calabasas", "hidden hills"],
    NORTH_VALLEY: ["northridge", "chatsworth", "granada hills", "porter ranch",
                   "van nuys", "reseda", "canoga park", "north hollywood",
                   "sun valley", "sylmar", "panorama city", "winnetka",
                   "west hills", "arleta", "pacoima", "mission hills",
                   "north hills", "lake balboa", "sepulveda", "san fernando",
                   "valley glen", "noho"],
    CENTRAL: ["silver lake", "silverlake", "echo park", "hollywood",
              "west hollywood", "los feliz", "eagle rock", "boyle heights",
              "highland park", "atwater village", "atwater", "glassell park",
              "koreatown", "mid-city", "mid city", "mid-wilshire", "larchmont",
              "hancock park", "east los angeles", "lincoln heights",
              "cypress park", "downtown", "dtla"],
    SOUTH_BAY: ["el segundo", "manhattan beach", "torrance", "redondo beach",
                "hawthorne", "inglewood", "gardena", "hermosa beach", "lawndale",
                "lomita", "carson", "san pedro", "wilmington", "harbor city",
                "palos verdes", "rancho palos verdes", "compton"],
    SGV: ["pasadena", "glendale", "arcadia", "alhambra", "monterey park",
          "san marino", "south pasadena", "sierra madre", "temple city",
          "rosemead", "san gabriel", "monrovia", "duarte", "altadena",
          "la canada", "la cañada", "montebello", "eagle rock"],
}.items() for z in cities}

# --- ZIP -> zone (used when the city is bare "Los Angeles" or missing) ---
def zip_zone(zp: str) -> str | None:
    z = zp[:5]
    ranges = [
        (WESTSIDE, {"90401","90402","90403","90404","90405","90291","90292",
                    "90293","90294","90295","90230","90232","90210","90211",
                    "90212","90024","90025","90064","90066","90067","90049",
                    "90272","90265","90094","90045","90034","90035"}),
        (CENTRAL, {"90012","90013","90014","90015","90017","90021","90071",
                   "90026","90027","90028","90038","90068","90046","90069",
                   "90004","90005","90006","90010","90020","90029","90039",
                   "90041","90042","90031","90032","90033","90065","90057",
                   "90019","90036","90048","90007","90011","90018"}),
        (SOUTH_VALLEY, {"91601","91602","91604","91607","91423","91403","91316",
                        "91335","91356","91436","91367","91364","91302","91505",
                        "91506","91501","91502","91504","91608"}),
        (NORTH_VALLEY, {"91324","91325","91326","91330","91311","91344","91345",
                        "91343","91406","91405","91411","91401","91402","91352",
                        "91342","91340","91331","91304","91303","91306","91307",
                        "91605","91606","91609","91352","91409"}),
        (SOUTH_BAY, {"90245","90266","90277","90278","90254","90250","90260",
                     "90301","90302","90303","90304","90305","90247","90248",
                     "90249","90501","90502","90503","90504","90505","90717",
                     "90710","90731","90732","90744","90745","90746","90747",
                     "90274","90275","90220","90221","90222"}),
        (SGV, {"91101","91103","91104","91105","91106","91107","91201","91202",
               "91203","91204","91205","91206","91207","91208","91001","91006",
               "91007","91801","91803","91754","91755","91108","91030","91024",
               "91780","91770","91775","91776","91016","91011","91214","91740"}),
    ]
    for zone, zips in ranges:
        if z in zips:
            return zone
    return None


def norm(s: str) -> str:
    return re.sub(r"[^a-z ]", "", (s or "").strip().lower())


def assign(v: dict) -> str | None:
    state = (v.get("state") or "").strip().upper()
    city = norm(v.get("city"))
    zp = re.sub(r"[^0-9]", "", v.get("zip") or "")

    # Out-of-state (or non-CA) → remote/out of area.
    if state and state != "CA":
        return REMOTE

    # Specific city match first.
    if city and city not in ("los angeles", "la"):
        # Longest-key match to avoid 'la' style false hits.
        for key in sorted(CITY_ZONE, key=len, reverse=True):
            if key in city:
                return CITY_ZONE[key]

    # Bare "Los Angeles" or unknown city → decide by ZIP.
    if len(zp) >= 5:
        z = zip_zone(zp)
        if z:
            return z

    # Generic "Los Angeles" with no usable ZIP → Central & Eastside is the
    # closest umbrella (DTLA/metro), but only when we at least know the city.
    if city in ("los angeles", "la") and not zp:
        return CENTRAL
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", default=".data/_vendors.json")
    args = ap.parse_args()
    vendors = json.load(open(args.dump))

    print("-- Vendor CRM: assign Area from address (blank areas only)")
    print("begin;")
    n = 0
    counts: dict[str, int] = {}
    for v in vendors:
        if (v.get("area") or "").strip():
            continue  # never overwrite an existing area
        if not any((v.get(k) or "").strip() for k in ("city", "state", "zip")):
            continue  # no address to work from
        zone = assign(v)
        if not zone:
            continue
        counts[zone] = counts.get(zone, 0) + 1
        n += 1
        print(f"update greendogops.crm_organization set area = "
              f"coalesce(area, '{zone}') where id = '{v['id']}';")
    print("commit;")
    for z, c in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"-- {c:4}  {z}", file=sys.stderr)
    print(f"-- assigned areas to {n} records", file=sys.stderr)


if __name__ == "__main__":
    main()
