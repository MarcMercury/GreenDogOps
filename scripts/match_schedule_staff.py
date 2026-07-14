#!/usr/bin/env python3
"""Match the GDD Staff Schedule "TEAM CHECK" roster (pages 2-4) to existing
greendogops.person rows and derive scheduling eligibility:

  * eligible_location_ids  <- the roster "Loc" column (SO / VEN / VLLY / E / R)
  * available_days         <- the roster "Un-Avail Days" column (days removed)

Identity matching is conservative: a roster name is only matched when exactly one
employee/contractor person row is a confident hit. Doctors stored as
"Dr. <first> <middle> <last>" are matched by token-subset against full_name.
Everything ambiguous or unmatched is reported and SKIPPED — former/applicant
rows are never touched and no person is created.

Output (NON-destructive, idempotent, REVIEW BEFORE APPLYING):
  * .data/schedule_eligibility.sql   - one UPDATE per matched person
  * stdout                            - coverage + exceptions report

Apply after review with:
    ./scripts/supabase-sql.sh -f .data/schedule_eligibility.sql

Usage:
    python scripts/match_schedule_staff.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pdfplumber

PDF = ".data/GDD Staff Schedule 2026.pdf"
OUT_SQL = ".data/schedule_eligibility.sql"
ROSTER_PAGES = (1, 2, 3)  # 0-indexed pages 2-4

TABLE_SETTINGS = {
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 4,
    "join_tolerance": 4,
}

# Roster "Loc" code -> set of location short_codes in the DB.
LOC_CODES = {
    "SO": ["SO"],
    "V": ["VEN"],
    "VE": ["VEN"],
    "VEN": ["VEN"],
    "VENICE": ["VEN"],
    "VLL": ["VAN"],
    "VLLY": ["VAN"],
    "VAN": ["VAN"],
    "E": [],   # "Everywhere" -> no restriction (empty = all locations)
    "R": [],   # Remote -> no clinic restriction
}

# Day-name tokens -> weekday index (0=Sun .. 6=Sat) for the Un-Avail column.
DAY_TOKENS = {
    "sun": 0, "sunday": 0,
    "mon": 1, "monday": 1,
    "tue": 2, "tues": 2, "tuesday": 2,
    "wed": 3, "weds": 3, "wednesday": 3,
    "thu": 4, "thur": 4, "thurs": 4, "thursday": 4, "th": 4,
    "fri": 5, "friday": 5,
    "sat": 6, "saturday": 6,
}

DR_PREFIX = re.compile(r"^\s*(dr\.?|doctor)\s+", re.I)


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def run_sql(query: str):
    """Run read-only SQL via the repo wrapper and return parsed JSON rows."""
    res = subprocess.run(
        ["./scripts/supabase-sql.sh", "-q", query],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        sys.exit(f"SQL failed: {res.stderr}")
    out = res.stdout.strip()
    # The wrapper may print a leading banner; isolate the JSON array.
    start = out.find("[")
    if start == -1:
        return []
    return json.loads(out[start:])


def norm(s: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def tokens(s: str) -> set:
    return {t for t in norm(s).split() if len(t) > 1}


# ---------------------------------------------------------------------------
# Load reference data
# ---------------------------------------------------------------------------

def load_people(statuses=("employee", "contractor")):
    in_list = ",".join(sql_str(s) for s in statuses)
    rows = run_sql(
        "set search_path=greendogops,public; "
        "select id, first_name, last_name, grid_name, full_name "
        f"from person where status in ({in_list});"
    )
    people = []
    for r in rows:
        first = norm(r.get("first_name"))
        last = norm(r.get("last_name"))
        grid = norm(r.get("grid_name"))
        full = norm(DR_PREFIX.sub("", r.get("full_name") or ""))
        # Candidate exact display strings this person answers to.
        names = set()
        if first and last:
            names.add(f"{first} {last}")
        if grid:
            names.add(grid)
        if full:
            names.add(full)
        people.append({
            "id": r["id"],
            "first": first, "last": last, "grid": grid,
            "full": full,
            "names": names,
            "tokens": tokens(r.get("full_name")) | {first, last, grid} - {""},
        })
    return people


def load_locations():
    rows = run_sql(
        "set search_path=greendogops,public; "
        "select id, short_code from location where is_active;"
    )
    return {r["short_code"]: r["id"] for r in rows}


# ---------------------------------------------------------------------------
# Roster extraction
# ---------------------------------------------------------------------------

def extract_roster():
    pdf = pdfplumber.open(PDF)
    roster = []
    seen = set()
    for pno in ROSTER_PAGES:
        table = pdf.pages[pno].extract_table(TABLE_SETTINGS)
        if not table:
            continue
        for row in table[4:]:
            name = (row[1] or "").strip()
            if not name or name.lower().startswith("last updated"):
                continue
            key = norm(name)
            if not key or key in seen:
                continue
            seen.add(key)
            roster.append({
                "name": name,
                "position": (row[2] or "").replace("\n", " ").strip(),
                "loc": (row[3] or "").replace("\n", " ").strip(),
                "unavail": (row[7] or "").replace("\n", " ").strip(),
            })
    return roster


def parse_loc(code: str, loc_ids: dict):
    """Roster Loc string -> sorted list of location UUIDs (empty = any)."""
    parts = re.split(r"[\s/,]+", (code or "").upper())
    out = []
    for p in parts:
        if p in LOC_CODES:
            for sc in LOC_CODES[p]:
                if loc_ids.get(sc) and loc_ids[sc] not in out:
                    out.append(loc_ids[sc])
    return out


def parse_available_days(unavail: str):
    """Un-Avail day string -> available weekday indices (all minus unavailable).

    Returns [] (meaning "any day") when no unavailable days are specified, so we
    never over-constrain someone whose row is blank.
    """
    found = set()
    for tok in re.split(r"[\s/,&]+", (unavail or "").lower()):
        tok = tok.strip(".")
        if tok in DAY_TOKENS:
            found.add(DAY_TOKENS[tok])
    if not found:
        return []
    return sorted(set(range(7)) - found)


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def match_person(name: str, people):
    """Return (person, reason) or (None, reason) for an ambiguous/no match."""
    raw = DR_PREFIX.sub("", name)
    key = norm(raw)
    ktoks = {t for t in key.split() if len(t) > 1}

    # 1) Exact display-name hit.
    exact = [p for p in people if key in p["names"]]
    if len(exact) == 1:
        return exact[0], "exact"
    if len(exact) > 1:
        return None, f"ambiguous-exact({len(exact)})"

    # 2) Token-subset: every roster token appears in the person's token set.
    subset = [p for p in people if ktoks and ktoks <= p["tokens"]]
    if len(subset) == 1:
        return subset[0], "token-subset"
    if len(subset) > 1:
        return None, f"ambiguous-subset({len(subset)})"

    # 3) First + last exact pair (handles middle names on either side).
    if len(ktoks) >= 2:
        fl = [p for p in people
              if {p["first"], p["last"]} <= ktoks]
        if len(fl) == 1:
            return fl[0], "first-last"
        if len(fl) > 1:
            return None, f"ambiguous-firstlast({len(fl)})"

    # 4) Unique last name (only when roster gave a single distinctive surname).
    last = key.split()[-1] if key.split() else ""
    if len(last) > 2:
        bylast = [p for p in people if p["last"] == last]
        if len(bylast) == 1:
            return bylast[0], "last-unique"
        if len(bylast) > 1:
            return None, f"ambiguous-last({len(bylast)})"

    return None, "no-match"


def main():
    people = load_people()
    loc_ids = load_locations()
    roster = extract_roster()

    matched = []
    skipped = []
    used = {}  # person_id -> roster name (detect double-matches)

    for r in roster:
        person, reason = match_person(r["name"], people)
        if not person:
            skipped.append((r, reason))
            continue
        if person["id"] in used:
            skipped.append((r, f"dup-of '{used[person['id']]}'"))
            continue
        used[person["id"]] = r["name"]
        locs = parse_loc(r["loc"], loc_ids)
        days = parse_available_days(r["unavail"])
        matched.append((r, person, reason, locs, days))

    # --- Emit reviewable SQL ------------------------------------------------
    lines = [
        "-- Schedule eligibility derived from TEAM CHECK roster (pages 2-4).",
        "-- Generated by scripts/match_schedule_staff.py. Review before applying.",
        "-- Idempotent: upserts only eligible_location_ids + available_days.",
        "set search_path = greendogops, public;",
        "",
    ]
    for r, person, reason, locs, days in matched:
        loc_arr = "array[" + ",".join(f"{sql_str(x)}::uuid" for x in locs) + "]::uuid[]" if locs else "'{}'::uuid[]"
        day_arr = "array[" + ",".join(str(d) for d in days) + "]::smallint[]" if days else "'{}'::smallint[]"
        lines.append(
            f"insert into sched_employee_setting (person_id, eligible_location_ids, available_days)\n"
            f"  values ({sql_str(person['id'])}, {loc_arr}, {day_arr})\n"
            f"  on conflict (person_id) do update set\n"
            f"    eligible_location_ids = excluded.eligible_location_ids,\n"
            f"    available_days = excluded.available_days;  -- {r['name']} [{r['loc']}]"
        )
    Path(OUT_SQL).write_text("\n".join(lines) + "\n")

    # --- Report -------------------------------------------------------------
    print("=" * 72)
    print(f"ROSTER ROWS: {len(roster)}   MATCHED: {len(matched)}   SKIPPED: {len(skipped)}")
    print(f"SQL written to {OUT_SQL} (review, then apply with -f)")
    print("=" * 72)
    print("\nMATCHED (roster -> person  via reason  | locs days):")
    for r, person, reason, locs, days in sorted(matched, key=lambda x: x[0]["name"].lower()):
        dnames = ",".join("SMTWHFS"[d] for d in days) if days else "any"
        lnames = str(len(locs)) + "loc" if locs else "any"
        print(f"  {r['name']:24} -> {person['full'] or person['first']+' '+person['last']:28} "
              f"[{reason:16}] {lnames:5} {dnames}")
    print(f"\nSKIPPED ({len(skipped)}) — left untouched, needs human review:")
    for r, reason in sorted(skipped, key=lambda x: x[0]["name"].lower()):
        print(f"  {r['name']:24} [{r['position'][:18]:18}] loc={r['loc']:8} reason={reason}")


if __name__ == "__main__":
    main()
