#!/usr/bin/env python3
"""Derive DEPARTMENT-LEVEL scheduling role eligibility (sched_role_member) from
the published weekly grids (pages 9-37 of the GDD Staff Schedule).

Why department-level (coarse) instead of per-role: the weekly grid has a
systematic vertical offset between the role-label column and the cell that holds
a name (DVM rows especially), so the exact role on a given row is unreliable.
The DEPARTMENT a tech belongs to *is* reliable (techs stay within their block),
so we map each matched person to the department(s) of the rows they appear in
and grant eligibility for that department's tech roles.

Rules:
  * A person stored as "Dr. ..." (a DVM) -> eligible for the DVM role of every
    real department (doctors rotate; their grid placement is offset/unreliable).
  * Any other person appearing >= MIN_APPEAR times in a department's rows ->
    eligible for that department's NON-doctor-track roles (excludes DVM, Intern,
    Extern/Student) of that department.

NON-destructive, idempotent: inserts into sched_role_member guarded by NOT
EXISTS. Writes reviewable SQL + a coverage report.

Output:
  * .data/schedule_role_members.sql
  * stdout report

Usage:
    python scripts/derive_role_members.py
    ./scripts/supabase-sql.sh -f .data/schedule_role_members.sql   # after review
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

import pdfplumber

from match_schedule_staff import (
    PDF, TABLE_SETTINGS, DR_PREFIX, norm,
    load_people, match_person, run_sql, sql_str,
)

OUT_SQL = ".data/schedule_role_members.sql"
GRID_PAGES = range(8, 37)  # 0-indexed pages 9-37
MIN_APPEAR = 2             # min cell appearances to grant a tech a department
NAME_COLS = range(2, 21)   # grid day/location columns (exclude roster sidebar 22+)

# Doctor-track roles a tech should NOT inherit at department level.
DOCTOR_TRACK = {"dvm", "intern", "extern/student", "extern"}

# Ordered (keyword -> department code) rules for the grid's col0 role label.
# Remote-block labels are mapped to CSR and checked first so "AP/SX/Support"
# (a remote support line) doesn't fall through to the AP rule.
REMOTE_HINTS = ("remote", "rcsr", "morning lead", "mid", "closer", "support",
                "texting", "tidio", "schd", "house admin", "in house")
DEPT_RULES = [
    ("manage", "MGMT"),
    ("surg", "SURG"),
    ("nad", "NAD"), ("da -", "NAD"), ("da-", "NAD"),
    ("clinic tech", "NAD"), ("dental", "NAD"), ("float / lead", "NAD"),
    ("im tech", "IM"),
    ("exotic", "EXO"),
    ("mpmv", "MPMV"),
    ("cardio", "CARD"),
    ("ap lead", "AP"), ("ap tech", "AP"), ("ap/", "AP"),
    ("csr", "CSR"), ("fac", "CSR"), ("referral", "CSR"), ("office admi", "CSR"),
]
SKIP_LABEL = ("note", "vacation", "meeting", "closed", "week", "role/meetin",
              "shift", "surgery/car", "ve note")


def label_to_dept(label: str):
    low = norm(label)
    if not low:
        return None
    if any(s in low for s in SKIP_LABEL):
        # "surgery/car" is a note row; real surgery rows say "surgery lead/tech".
        if "surgery lead" in low or "surgery tech" in low:
            pass
        else:
            return None
    if any(h in low for h in REMOTE_HINTS):
        return "CSR"
    for kw, dept in DEPT_RULES:
        if kw in low:
            return dept
    return None


def clean_fragment(frag: str) -> str:
    """Strip footnotes/parentheticals/times/events from a cell name fragment."""
    f = re.sub(r"\[[^\]]*\]?", " ", frag)      # [5] footnotes (even unclosed)
    f = re.sub(r"\([^)]*\)?", " ", f)           # (notes)
    f = re.sub(r"\d[\d:.\sapm-]*", " ", f, flags=re.I)  # times / numbers
    return f.strip(" -/")


def load_roles_by_dept():
    rows = run_sql(
        "set search_path=greendogops,public; "
        "select r.id, r.name, d.code dept from sched_role r "
        "join sched_department d on d.id=r.department_id;"
    )
    tech = defaultdict(list)   # dept -> [role_id] (non doctor-track)
    dvm = []                   # [role_id] for every department's DVM role
    for r in rows:
        if norm(r["name"]) == "dvm":
            dvm.append(r["id"])
        elif norm(r["name"]) not in DOCTOR_TRACK:
            tech[r["dept"]].append(r["id"])
    return tech, dvm


def main():
    people = load_people()
    dvm_ids = {
        r["id"] for r in run_sql(
            "set search_path=greendogops,public; select id from person "
            "where status in ('employee','contractor') and full_name ilike 'dr.%';"
        )
    }
    tech_roles, dvm_roles = load_roles_by_dept()

    pdf = pdfplumber.open(PDF)
    # person_id -> {dept -> appearance count}  (techs only)
    tech_seen = defaultdict(lambda: defaultdict(int))
    dvm_persons = set()
    name_cache = {}

    def resolve(frag):
        key = norm(frag)
        if not key:
            return None
        if key in name_cache:
            return name_cache[key]
        person, reason = match_person(frag, people)
        pid = person["id"] if person else None
        name_cache[key] = pid
        return pid

    for pno in GRID_PAGES:
        table = pdf.pages[pno].extract_table(TABLE_SETTINGS)
        if not table:
            continue
        for row in table:
            dept = label_to_dept(row[0] or "")
            if not dept:
                continue
            for ci in NAME_COLS:
                if ci >= len(row):
                    break
                cell = row[ci] or ""
                for frag in re.split(r"[\n/]", cell):
                    frag = clean_fragment(frag)
                    if len(norm(frag)) < 3:
                        continue
                    pid = resolve(frag)
                    if not pid:
                        continue
                    if pid in dvm_ids:
                        dvm_persons.add(pid)
                    else:
                        tech_seen[pid][dept] += 1

    # --- Build membership set (person_id, role_id) --------------------------
    pairs = set()
    # Doctors: DVM role of every department.
    for pid in dvm_persons:
        for rid in dvm_roles:
            pairs.add((pid, rid))
    # Techs: department's non-doctor-track roles, gated by MIN_APPEAR.
    granted_dept = defaultdict(set)  # pid -> {dept}
    for pid, depts in tech_seen.items():
        for dept, n in depts.items():
            if n >= MIN_APPEAR and dept in tech_roles:
                granted_dept[pid].add(dept)
                for rid in tech_roles[dept]:
                    pairs.add((pid, rid))

    # --- Emit reviewable SQL ------------------------------------------------
    lines = [
        "-- Department-level scheduling eligibility (sched_role_member),",
        "-- derived from published weekly grids by scripts/derive_role_members.py.",
        "-- Idempotent: each insert guarded by NOT EXISTS. Review before applying.",
        "set search_path = greendogops, public;",
        "",
    ]
    for pid, rid in sorted(pairs):
        lines.append(
            "insert into sched_role_member (role_id, person_id)\n"
            f"  select {sql_str(rid)}, {sql_str(pid)}\n"
            "  where not exists (select 1 from sched_role_member m\n"
            f"    where m.role_id={sql_str(rid)} and m.person_id={sql_str(pid)});"
        )
    Path(OUT_SQL).write_text("\n".join(lines) + "\n")

    # --- Report -------------------------------------------------------------
    pid_name = {p["id"]: (p["full"] or f"{p['first']} {p['last']}") for p in people}
    print("=" * 72)
    print(f"DVMs granted DVM roles: {len(dvm_persons)}   "
          f"Techs granted dept roles: {len(granted_dept)}   "
          f"role-member rows: {len(pairs)}")
    print(f"SQL written to {OUT_SQL} (review, then apply with -f)")
    print(f"(MIN_APPEAR={MIN_APPEAR} cell appearances to grant a tech a department)")
    print("=" * 72)
    print("\nDOCTORS -> all DVM roles:")
    for pid in sorted(dvm_persons, key=lambda x: pid_name.get(x, "")):
        print(f"  {pid_name.get(pid, pid)}")
    print("\nTECHS -> departments (appearance counts):")
    for pid in sorted(tech_seen, key=lambda x: pid_name.get(x, "")):
        counts = tech_seen[pid]
        granted = sorted(granted_dept.get(pid, []))
        shown = ", ".join(f"{d}:{counts[d]}" for d in sorted(counts, key=lambda d: -counts[d]))
        flag = "" if granted else "   (none >= MIN_APPEAR -> skipped)"
        print(f"  {pid_name.get(pid, pid):28} granted={granted}  seen[{shown}]{flag}")


if __name__ == "__main__":
    main()
