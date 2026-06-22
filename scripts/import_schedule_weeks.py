#!/usr/bin/env python3
"""Import the former published weekly schedules (pages 9-37) into the scheduling
tables: sched_week + sched_week_line (snapshot) + sched_assignment.

FULL BEST-EFFORT (user-chosen): every grid cell that resolves to an employee is
imported. Because the grid has a vertical offset on doctor rows, DVM placements
are re-targeted to the DVM line of the row's department and FLAGGED in the
exceptions report as low-confidence. Tech/CSR rows align reliably.

Line resolution: each week snapshots the 67 active shift templates into
sched_week_line (carrying template_id). An assignment resolves its line via
(week_id, template_id), so per-week UUIDs never need to be hard-coded.

Output (review before applying):
  * .data/import_weeks.sql                - idempotent DO-block per week
  * .data/import_weeks_exceptions.txt      - unmatched + low-confidence cells
  * stdout                                 - per-week coverage summary

Apply after review:
    ./scripts/supabase-sql.sh -f .data/import_weeks.sql

Usage:
    python scripts/import_schedule_weeks.py
"""
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import pdfplumber

from match_schedule_staff import (
    PDF, TABLE_SETTINGS, norm, load_people, match_person, run_sql, sql_str,
)

OUT_SQL = ".data/import_weeks.sql"
OUT_EXC = ".data/import_weeks_exceptions.txt"
GRID_PAGES = range(8, 37)  # 0-indexed pages 9-37
ANCHOR = date(2026, 5, 28)  # cursor seed; first week resolves to Sun 2026-05-31

# Per-day grid columns -> (column index, location short_code).
DAY_COLS = {
    0: [(2, "SO")],                                  # Sunday (single column)
    1: [(3, "SO"), (4, "VEN"), (5, "VAN")],          # Monday
    2: [(6, "SO"), (7, "VEN"), (8, "VAN")],          # Tuesday
    3: [(9, "SO"), (10, "VEN"), (11, "VAN")],        # Wednesday
    4: [(12, "SO"), (13, "VEN"), (14, "VAN")],       # Thursday
    5: [(15, "SO"), (16, "VEN"), (17, "VAN")],       # Friday
    6: [(18, "SO"), (19, "VEN"), (20, "VAN")],       # Saturday
}
SUNDAY_COL = 2

# Column that carries each day's date number in the WEEK header row.
DAY_DATE_COL = {0: 2, 1: 3, 2: 6, 3: 9, 4: 12, 5: 15, 6: 18}

STATUS_MAP = [("pub", "published"), ("rtc", "pending_approval"), ("rg", "approved")]

# Ordered label classification -> (dept_code or "", role_name). "" = legacy dept.
# Department-identifying rules set the running department context; the generic
# Intern/Extern rules inherit it.
DEPT_HEADERS = [
    ("vet-surgery", "SURG"), ("vet-ap", "AP"), ("vet-nad", "NAD"),
    ("vet-im", "IM"), ("vet-exotic", "EXO"), ("vet-mpmv", "MPMV"),
    ("vet-cardio", "CARD"),
]
ROLE_RULES = [
    # remote / legacy block (dept "")
    ("rcsr", "", "RCSR Manager"),
    ("remote schd", "", "RCSR Manager"),
    ("morning lea", "", "Morning Lead"),
    ("ap/sx", "", "AP/SX"),
    ("texting", "", "Texting / Tidio"),
    ("tidio", "", "Texting / Tidio"),
    ("closer", "", "Closer"),
    ("office admi", "", "Office Admin"),
    # management
    ("manage", "MGMT", "Manager"),
    # surgery
    ("surgery lead", "SURG", "Surgery Lead"),
    ("surgery tec", "SURG", "Surgery Tech 1"),
    # AP
    ("ap lead", "AP", "AP Lead"),
    ("ap tech/rem", "AP", "Remote AP Tech"),
    ("remote ap", "AP", "Remote AP Tech"),
    ("ap tech", "AP", "AP Tech"),
    # NAD
    ("da - train", "NAD", "DA - Training"),
    ("da-train", "NAD", "DA - Training"),
    ("da - nad", "NAD", "DA - NAD"),
    ("da-nad", "NAD", "DA - NAD"),
    ("float / lead", "NAD", "Float / Lead"),
    ("float/lead", "NAD", "Float / Lead"),
    ("clinic tech", "NAD", "Clinic Tech"),
    ("dentals (tr", "NAD", "Dentals (trainee)"),
    ("dentals", "NAD", "Dentals"),
    # IM
    ("im tech/da", "IM", "IM Tech/DA"),
    ("im tech", "IM", "IM Tech"),
    # EXO
    ("exotic tech/da", "EXO", "Exotic Tech/DA"),
    ("exotic tech", "EXO", "Exotic Tech/DA"),
    ("exotics tec", "EXO", "Exotics Tech"),
    # MPMV
    ("mpmv med te", "MPMV", "MPMV Tech"),
    ("mpmv tech", "MPMV", "MPMV Tech"),
    # CSR
    ("csr lead", "CSR", "CSR Lead"),
    ("csr/fac", "CSR", "FAC"),
    ("referral", "CSR", "Referral C"),
    ("in house ad", "CSR", "In House Admin/Marketing Assist"),
    ("house admin", "CSR", "In House Admin/Marketing Assist"),
    ("csr", "CSR", "CSR"),
    ("fac", "CSR", "FAC"),
    # remote block continued (after CSR so "Mid"/"Support"/"Float" don't shadow)
    ("mid", "", "Mid"),
    ("support", "", "Support"),
    ("float", "", "Float"),
]
GENERIC_DOCTOR_TRACK = [("intern", "Intern"), ("exrtern", "Extern/Student"),
                        ("extern", "Extern/Student")]
SKIP_LABEL = ("note", "vacation", "meeting", "closed", "surgery/car", "mpmv\n",
              "ve note", "ap note", "im note", "uc note", "role/meetin")


def classify(label, current_dept):
    """Return (dept_code, role_name, new_current_dept) or (None, None, current_dept)."""
    low = norm(label)
    if not low:
        return None, None, current_dept
    if low.startswith("week"):
        return None, None, current_dept
    if any(s in low for s in ("note", "vacation", "meeting")):
        return None, None, current_dept
    for kw, dept in DEPT_HEADERS:
        if kw in low:
            return dept, "DVM", dept
    for kw, dept, role in ROLE_RULES:
        if kw in low:
            return dept, role, (dept or current_dept)
    for kw, role in GENERIC_DOCTOR_TRACK:
        if kw in low:
            return current_dept, role, current_dept
    return None, None, current_dept


def clean_fragment(frag):
    f = re.sub(r"\[[^\]]*\]?", " ", frag)
    f = re.sub(r"\([^)]*\)?", " ", f)
    f = re.sub(r"\d[\d:.\sapm-]*", " ", f, flags=re.I)
    return f.strip(" -/")


def resolve_status(raw):
    low = norm(raw)
    for kw, st in STATUS_MAP:
        if kw in low:
            return st
    return "draft"


def resolve_week_start(header_row, cursor):
    """Compute the Sunday date for a WEEK header row from its day-numbers."""
    num = None
    cell = header_row[SUNDAY_COL] if len(header_row) > SUNDAY_COL else ""
    m = re.search(r"(\d{1,2})", cell or "")
    if m:
        num = int(m.group(1))
    if num is None:
        return cursor
    for delta in range(-4, 14):
        c = cursor + timedelta(days=delta)
        if c.day == num:
            return c
    return cursor


def main(pdf_path=PDF, grid_pages=GRID_PAGES, anchor=ANCHOR, out_sql=OUT_SQL,
         out_exc=OUT_EXC, part_dir_path=".data/import_weeks",
         status_override=None):
    # Prefer active staff; fall back to former (historical schedule includes
    # people who have since left). Two tiers also disambiguate duplicate
    # name records that differ only by status.
    people_active = load_people(("employee", "contractor"))
    people_all = load_people(("employee", "contractor", "former"))
    dvm_ids = {
        r["id"] for r in run_sql(
            "set search_path=greendogops,public; select id from person "
            "where status in ('employee','contractor') and full_name ilike 'dr.%';"
        )
    }
    loc_ids = {r["short_code"]: r["id"] for r in run_sql(
        "set search_path=greendogops,public; select id, short_code from location where is_active;"
    )}

    # Canonical lines: (dept_code or "", role_name) -> [template_id ordered].
    tpl_rows = run_sql(
        "set search_path=greendogops,public; "
        "select t.id, coalesce(d.code,'') dept, coalesce(r.name,t.label) role, t.sort_order "
        "from sched_shift_template t join sched_department d on d.id=t.department_id "
        "left join sched_role r on r.id=t.role_id where t.is_active order by t.sort_order;"
    )
    tpl_by_dr = defaultdict(list)
    for t in tpl_rows:
        tpl_by_dr[(t["dept"], norm(t["role"]))].append(t["id"])

    def find_template(dept, role, counter):
        key = (dept or "", norm(role))
        ids = tpl_by_dr.get(key)
        if not ids:
            return None
        idx = min(counter[key], len(ids) - 1)
        counter[key] += 1
        return ids[idx]

    name_cache = {}

    def resolve_person(frag):
        key = norm(frag)
        if len(key) < 3:
            return None
        if key in name_cache:
            return name_cache[key]
        person, _ = match_person(frag, people_active)
        if not person:
            person, _ = match_person(frag, people_all)
        pid = person["id"] if person else None
        name_cache[key] = pid
        return pid

    pdf = pdfplumber.open(pdf_path)
    cursor = anchor
    last_start = date.min
    weeks = []            # list of dicts: week_start, status, title, assigns[]
    exceptions = []       # (week_start, day, label, fragment, reason)

    for pno in grid_pages:
        table = pdf.pages[pno].extract_table(TABLE_SETTINGS)
        if not table:
            continue
        cur_week = None
        current_dept = None
        counter = None
        for row in table:
            label = (row[0] or "")
            if norm(label).startswith("week"):
                week_start = resolve_week_start(row, cursor)
                # Reject spurious / duplicate headers (must advance ~a week).
                if week_start <= last_start + timedelta(days=3):
                    cur_week = None
                    continue
                last_start = week_start
                cursor = week_start + timedelta(days=7)
                status = status_override or resolve_status(
                    row[1] if len(row) > 1 else "")
                cur_week = {
                    "week_start": week_start,
                    "status": status,
                    "title": label.strip().split("\n")[0],
                    "assigns": [],       # (template_id, loc_id, day, work_date, person_id)
                    "seen": set(),
                }
                weeks.append(cur_week)
                current_dept = None
                counter = defaultdict(int)
                continue
            if cur_week is None:
                continue
            dept, role, current_dept = classify(label, current_dept)
            if not role:
                continue
            for day, cols in DAY_COLS.items():
                for ci, sc in cols:
                    if ci >= len(row):
                        continue
                    cell = row[ci] or ""
                    for frag in re.split(r"[\n/]", cell):
                        frag = clean_fragment(frag)
                        if len(norm(frag)) < 3:
                            continue
                        pid = resolve_person(frag)
                        wk = cur_week["week_start"]
                        if not pid:
                            # Only report fragments that look like a name (alpha).
                            if re.search(r"[a-zA-Z]{3,}", frag) and " " in frag.strip():
                                exceptions.append((wk, day, label.strip(), frag, "unmatched"))
                            continue
                        tgt_dept, tgt_role = dept, role
                        flag = None
                        if pid in dvm_ids and norm(role) != "dvm":
                            # Re-target offset doctor names to the dept DVM line
                            # when one exists; otherwise keep the parsed role.
                            dvm_dept = dept or current_dept
                            if tpl_by_dr.get((dvm_dept or "", "dvm")):
                                tgt_dept, tgt_role, flag = dvm_dept, "DVM", "dvm-offset"
                        tpl = find_template(tgt_dept, tgt_role, counter)
                        if not tpl:
                            exceptions.append((wk, day, label.strip(), frag,
                                               f"no-line({tgt_dept}/{tgt_role})"))
                            continue
                        loc_id = loc_ids.get(sc)
                        if not loc_id:
                            continue
                        work_date = wk + timedelta(days=day)
                        key = (tpl, loc_id, day, pid)
                        if key in cur_week["seen"]:
                            continue
                        cur_week["seen"].add(key)
                        cur_week["assigns"].append(
                            (tpl, loc_id, day, work_date, pid))
                        if flag:
                            exceptions.append((wk, day, label.strip(), frag, flag))

    # --- Emit SQL -----------------------------------------------------------
    out = [
        "-- Former published weekly schedules imported by",
        "-- scripts/import_schedule_weeks.py (full best-effort). Review first.",
        "-- Idempotent: re-running rebuilds each week's lines + assignments.",
        "set search_path = greendogops, public;",
        "",
    ]
    weeks = [w for w in weeks if w["assigns"]]
    total_assigns = 0
    part_dir = Path(part_dir_path)
    part_dir.mkdir(parents=True, exist_ok=True)
    for old in part_dir.glob("week_*.sql"):
        old.unlink()
    for wi, w in enumerate(weeks):
        ws = w["week_start"].isoformat()
        block = ["set search_path = greendogops, public;",
                 "do $$ declare wid uuid; begin"]
        block.append(
            f"  insert into sched_week (week_start, status, title) "
            f"values ({sql_str(ws)}, {sql_str(w['status'])}, {sql_str(w['title'])})\n"
            f"    on conflict (week_start) do update set status = excluded.status "
            f"returning id into wid;")
        block.append(
            "  if not exists (select 1 from sched_week_line where week_id = wid) then\n"
            "    insert into sched_week_line (week_id, template_id, department_id, role_id, label, start_time, end_time, sort_order)\n"
            "      select wid, id, department_id, role_id, label, start_time, end_time, sort_order\n"
            "      from sched_shift_template where is_active;\n"
            "  end if;")
        block.append(
            "  if not exists (select 1 from sched_week_location where week_id = wid) then\n"
            "    insert into sched_week_location (week_id, location_id, sort_order)\n"
            "      select wid, id, sort_order from location where is_active;\n"
            "  end if;")
        block.append("  delete from sched_assignment where week_id = wid;")
        for tpl, loc_id, day, wd, pid in w["assigns"]:
            block.append(
                "  insert into sched_assignment (week_id, line_id, location_id, person_id, day_of_week, work_date, attendance_status)\n"
                f"    select wid, wl.id, {sql_str(loc_id)}, {sql_str(pid)}, {day}, {sql_str(wd.isoformat())}, 'scheduled'\n"
                f"    from sched_week_line wl where wl.week_id = wid and wl.template_id = {sql_str(tpl)} limit 1;")
            total_assigns += 1
        block.append("end $$;")
        out.append("")
        out.extend(block[1:])  # combined file: skip per-part search_path repeat
        out.append("")
        (part_dir / f"week_{wi:02d}_{ws}.sql").write_text("\n".join(block) + "\n")
    Path(out_sql).write_text("\n".join(out) + "\n")

    # --- Exceptions ---------------------------------------------------------
    elines = [f"{ws}\tday{d}\t{lbl}\t{frag}\t{reason}"
              for ws, d, lbl, frag, reason in exceptions]
    Path(out_exc).write_text("\n".join(elines) + "\n")

    # --- Report -------------------------------------------------------------
    by_reason = defaultdict(int)
    for *_, reason in exceptions:
        by_reason[reason.split("(")[0]] += 1
    print("=" * 72)
    print(f"WEEKS: {len(weeks)}   ASSIGNMENTS: {total_assigns}   "
          f"EXCEPTIONS: {len(exceptions)}")
    print(f"SQL -> {OUT_SQL}   exceptions -> {OUT_EXC}")
    print("=" * 72)
    print("\nWeeks (start, status, #assignments):")
    for w in weeks:
        print(f"  {w['week_start']}  {w['status']:16} {len(w['assigns']):4}  {w['title']}")
    print("\nException counts by reason:")
    for r, n in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"  {n:5}  {r}")


def _parse_pages(spec):
    """'8-36' -> range(8,37); '0-3' -> range(0,4); also accepts single ints."""
    a, _, b = spec.partition("-")
    lo = int(a)
    hi = int(b) if b else lo
    return range(lo, hi + 1)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pdf", default=PDF, help="source schedule PDF")
    ap.add_argument("--pages", default="8-36",
                    help="0-indexed grid page range, e.g. '0-3' (default 8-36)")
    ap.add_argument("--anchor", default=ANCHOR.isoformat(),
                    help="YYYY-MM-DD cursor seed (a few days before week 1)")
    ap.add_argument("--status", default=None,
                    help="force a status for every week (e.g. 'published')")
    ap.add_argument("--out-sql", default=OUT_SQL)
    ap.add_argument("--out-exc", default=OUT_EXC)
    ap.add_argument("--part-dir", default=".data/import_weeks")
    args = ap.parse_args()

    main(
        pdf_path=args.pdf,
        grid_pages=_parse_pages(args.pages),
        anchor=date.fromisoformat(args.anchor),
        out_sql=args.out_sql,
        out_exc=args.out_exc,
        part_dir_path=args.part_dir,
        status_override=args.status,
    )
