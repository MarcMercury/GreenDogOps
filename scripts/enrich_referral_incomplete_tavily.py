#!/usr/bin/env python3
"""Fill missing key fields for Referral CRM partners via Tavily web search.

Fields targeted (only when blank):
- name (falls back to hospital_name)
- address
- email
- phone
- contact_name (primary contact; conservative Dr. name extraction)
- clinic_type (heuristic from clinic name)
- zone (inferred from zip/city against existing zoned records)
- website

Usage:
  set -a; source .secrets/enrich.env; source .secrets/supabase.env; set +a
  python scripts/enrich_referral_incomplete_tavily.py --limit 50 > .data/_referral_incomplete_updates.sql
  ./scripts/supabase-sql.sh -f .data/_referral_incomplete_updates.sql
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
import urllib.request
from collections import Counter, defaultdict
from typing import Any

TAVILY_KEY = os.environ.get("TAVILY_API_KEY", "")
TAVILY_URL = "https://api.tavily.com/search"

DIRECTORY_HOSTS = (
    "yelp.", "zoominfo.", "facebook.", "instagram.", "linkedin.", "mapquest.",
    "yellowpages.", "bbb.org", "indeed.", "glassdoor.", "tripadvisor.",
    "google.", "apple.", "foursquare.", "nextdoor.", "pinterest.", "twitter.",
    "x.com", "tiktok.", "crunchbase.", "dnb.com", "buzzfile.", "manta.",
    "chamberofcommerce.", "birdeye.", "wikipedia.", "youtube.", "reddit.",
    "medium.", "blogspot", "wordpress.", "bing.", "yahoo.", "mapcarta",
    "ezlocal", "hotfrog", "citysearch", "superpages", "local.com", "n49.",
)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)")
ADDR_RE = re.compile(
    r"(\d{1,6}\s+[A-Za-z0-9 .,'#\-]{3,80}?),\s*([A-Za-z .'-]{2,50}),\s*(?:CA|California)\b(?:\s+|,\s*)(\d{5})(?:-\d{4})?",
    re.I,
)
DR_RE = re.compile(r"\b(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b")
ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")
CITY_CA_RE = re.compile(r",\s*([A-Za-z .'-]{2,50}),\s*(?:CA|California)\b", re.I)

ZONE_DEFS = [
    "Westside & Coastal",
    "South Valley",
    "North Valley",
    "Central & Eastside",
    "South Bay",
    "San Gabriel Valley",
]

FREE_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
    "me.com", "msn.com", "live.com", "sbcglobal.net", "verizon.net", "att.net", "mail.com",
    "proton.me", "protonmail.com", "gmx.com",
}


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


def first_email(v: str | None) -> str | None:
    s = clean(v)
    if not s:
        return None
    m = EMAIL_RE.search(s)
    return m.group(0).lower() if m else None


def website_from_email(email_value: str | None) -> str | None:
    em = first_email(email_value)
    if not em:
        return None
    dom = em.split("@")[-1].lower()
    if dom in FREE_EMAIL_DOMAINS:
        return None
    if dom.startswith("xxx"):
        return None
    return f"https://{dom}"


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "")
    return (m.group(1).lower().lstrip("www.") if m else "")


def is_directory(url: str) -> bool:
    h = host_of(url)
    return any(d in h for d in DIRECTORY_HOSTS)


def supabase_sql(query: str) -> list[dict[str, Any]]:
    proc = subprocess.run(
        ["./scripts/supabase-sql.sh", "-q", query],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    if not isinstance(payload, list):
        return []
    return payload


def tavily(query: str) -> dict[str, Any] | None:
    body = json.dumps(
        {
            "api_key": TAVILY_KEY,
            "query": query,
            "search_depth": "basic",
            "max_results": 6,
            "include_raw_content": True,
        }
    ).encode()
    req = urllib.request.Request(TAVILY_URL, data=body, headers={"Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "ignore")[:200]
            if e.code in (429, 432, 433):
                time.sleep(1.5 * (attempt + 1))
                continue
            eprint(f"tavily HTTP {e.code}: {msg}")
            return None
        except Exception as e:  # noqa: BLE001
            if attempt == 4:
                eprint(f"tavily error: {e}")
                return None
            time.sleep(1.2 * (attempt + 1))
    return None


def normalize_phone(text: str) -> str | None:
    m = PHONE_RE.search(text or "")
    if not m:
        return None
    a, b, c = m.groups()
    return f"({a}) {b}-{c}"


def extract_address(text: str) -> str | None:
    m = ADDR_RE.search(text or "")
    if not m:
        return None
    street, city, zip_code = m.groups()
    street = re.sub(r"\s+", " ", street).strip(" ,")
    city = re.sub(r"\s+", " ", city).strip(" ,")
    return f"{street}, {city}, CA {zip_code}"


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


def pick_clinic_type(name: str) -> str:
    n = (name or "").lower()
    if "emergency" in n or "er" in n or "24" in n:
        return "emergency"
    if "special" in n or "specialist" in n:
        return "specialty"
    if "urgent" in n:
        return "urgent_care"
    if "mobile" in n:
        return "mobile"
    if "shelter" in n:
        return "shelter"
    return "general"


def infer_zone(address: str | None, zip_to_zone: dict[str, str], city_to_zone: dict[str, str]) -> str | None:
    z = extract_zip(address)
    if z and z in zip_to_zone:
        return zip_to_zone[z]
    c = extract_city(address)
    if c and c.lower() in city_to_zone:
        return city_to_zone[c.lower()]
    return None


def build_zone_maps(rows: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    by_zip: dict[str, Counter[str]] = defaultdict(Counter)
    by_city: dict[str, Counter[str]] = defaultdict(Counter)

    for r in rows:
        zone = clean(r.get("zone"))
        addr = clean(r.get("address"))
        if not zone or zone not in ZONE_DEFS or not addr:
            continue
        z = extract_zip(addr)
        c = extract_city(addr)
        if z:
            by_zip[z][zone] += 1
        if c:
            by_city[c.lower()][zone] += 1

    zip_map = {k: v.most_common(1)[0][0] for k, v in by_zip.items() if v}
    city_map = {k: v.most_common(1)[0][0] for k, v in by_city.items() if v}
    return zip_map, city_map


def is_blank(v: Any) -> bool:
    return clean(v) is None


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich incomplete referral partner records")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N incomplete rows")
    parser.add_argument("--sleep", type=float, default=0.4, help="Delay between Tavily calls")
    args = parser.parse_args()

    if not TAVILY_KEY:
        eprint("TAVILY_API_KEY not set")
        return 1
    base_rows = supabase_sql(
        """
        select id, name, hospital_name, address, email, phone, contact_name, contact_person, clinic_type, zone, website
        from greendogops.referral_partners
        order by coalesce(name, hospital_name) asc nulls last
        """
    )

    incomplete = [
        r
        for r in base_rows
        if is_blank(r.get("name"))
        or is_blank(r.get("address"))
        or is_blank(r.get("email"))
        or is_blank(r.get("phone"))
        or (is_blank(r.get("contact_name")) and is_blank(r.get("contact_person")))
        or is_blank(r.get("clinic_type"))
        or is_blank(r.get("zone"))
        or is_blank(r.get("website"))
    ]

    if args.limit > 0:
        incomplete = incomplete[: args.limit]

    zip_to_zone, city_to_zone = build_zone_maps(base_rows)

    updates: list[tuple[str, dict[str, str]]] = []

    for idx, row in enumerate(incomplete, start=1):
        name = clean(row.get("name")) or clean(row.get("hospital_name")) or ""
        if not name:
            continue

        query = f"{name} Los Angeles veterinary clinic contact website phone email address"
        patch: dict[str, str] = {}

        # Fast deterministic fills before web search.
        if is_blank(row.get("website")):
            inferred_site = website_from_email(row.get("email"))
            if inferred_site:
                patch["website"] = inferred_site

        if is_blank(row.get("zone")):
            inferred_zone = infer_zone(clean(row.get("address")), zip_to_zone, city_to_zone)
            if inferred_zone:
                patch["zone"] = inferred_zone

        needs_web = any(
            [
                is_blank(row.get("address")) and "address" not in patch,
                is_blank(row.get("email")),
                is_blank(row.get("phone")),
                is_blank(row.get("contact_name")) and is_blank(row.get("contact_person")),
                is_blank(row.get("website")) and "website" not in patch,
            ]
        )

        all_text = ""
        official_url: str | None = None
        if needs_web:
            res = tavily(query)
            if res is not None:
                results = res.get("results", []) if isinstance(res, dict) else []
                texts: list[str] = []

                for r in results:
                    url = clean(r.get("url"))
                    if url and not official_url and not is_directory(url):
                        official_url = url
                    chunk = "\n".join(
                        [
                            str(r.get("title") or ""),
                            str(r.get("content") or ""),
                            str(r.get("raw_content") or ""),
                        ]
                    )
                    texts.append(chunk)

                all_text = "\n".join(texts)

        if is_blank(row.get("name")) and clean(row.get("hospital_name")):
            patch["name"] = clean(row.get("hospital_name")) or ""

        if is_blank(row.get("website")) and "website" not in patch and official_url:
            patch["website"] = official_url

        if is_blank(row.get("phone")):
            ph = normalize_phone(all_text)
            if ph:
                patch["phone"] = ph

        found_address = None
        if is_blank(row.get("address")):
            found_address = extract_address(all_text)
            if found_address:
                patch["address"] = found_address

        if is_blank(row.get("email")):
            # Prefer emails matching the official domain if we found one.
            official_domain = host_of(patch.get("website") or clean(row.get("website")) or "")
            picked = None
            for em in EMAIL_RE.findall(all_text):
                em = em.strip().strip(".,;:").lower()
                if "example" in em or "sentry" in em:
                    continue
                dom = em.split("@")[-1]
                if official_domain and dom == official_domain:
                    picked = em
                    break
            if not picked and not official_domain:
                for em in EMAIL_RE.findall(all_text):
                    em = em.strip().strip(".,;:").lower()
                    if "example" in em or "sentry" in em:
                        continue
                    picked = em
                    break
            if picked:
                patch["email"] = picked

        if is_blank(row.get("contact_name")) and is_blank(row.get("contact_person")):
            # Conservative: only use a clearly prefixed doctor name.
            m = DR_RE.search(all_text)
            if m:
                patch["contact_name"] = m.group(1).replace("Dr.", "Dr").strip()

        if is_blank(row.get("clinic_type")):
            patch["clinic_type"] = pick_clinic_type(name)

        if is_blank(row.get("zone")) and "zone" not in patch:
            zone = infer_zone(found_address or clean(row.get("address")), zip_to_zone, city_to_zone)
            if zone:
                patch["zone"] = zone

        # Skip no-op rows.
        if not patch:
            continue

        updates.append((row["id"], patch))
        eprint(f"[{idx}/{len(incomplete)}] {name}: +{', '.join(sorted(patch.keys()))}")
        time.sleep(max(0.0, args.sleep))

    print("-- Referral CRM: incomplete record enrichment (Tavily)")
    print("-- Generated by scripts/enrich_referral_incomplete_tavily.py")
    print("begin;")
    for row_id, patch in updates:
        sets = []
        for col in ("name", "address", "email", "phone", "contact_name", "clinic_type", "zone", "website"):
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
