#!/usr/bin/env python3
"""Parse the "Western Grid - Students Comprehensive" workbook and emit SQL
inserts into greendogops.crm_contact (contact_type='student').

The workbook has several year-grid tabs (2025, 2026, 2027, HIRE 2025, …) that
share a left-hand layout but drift on the right-hand side: some rows are shifted
by a column and the number of trailing columns varies per sheet. The left side
is stable, so those are read by fixed index:

  0 Type | 1 Name | 2 Location | 3 DVM | 4 Weekday | 5 Email

The right side is resolved by anchoring on the "Grad Year" cell (always a
"DVM 20XX" token). The six numeric date cells sit immediately before it and the
stipend / completion flags immediately after it, which survives the per-row
column drift:

  … [Start Mo Day Yr] [End Mo Day Yr] [DVM 20XX] [Stipend] [Completed]
    [Stipend Paid] [Check cashed]

Rows are de-duplicated by email across sheets; later sheets fill in / override
earlier ones so nothing is lost.

Usage:
    python3 scripts/import_students.py [path/to/workbook.xlsx] > out.sql
"""
import re
import sys

import openpyxl

DEFAULT_SRC = "public/Christinas Western Grid - Students Comprehensive.xlsx"
SOURCE = "student_grid_xlsx"

SKIP_NAMES = {"example", "16 students", "completed below", "none"}
COLORS = {"green", "red", "yellow", "orange"}
GRAD_RE = re.compile(r"(?i)\bDVM\s*\d{4}\b")
NUMERIC_RE = re.compile(r"^-?\d+(\.\d+)?$")


def s(v):
    """SQL string literal (or null)."""
    if v is None:
        return "null"
    v = str(v).strip()
    if v == "":
        return "null"
    return "'" + v.replace("'", "''") + "'"


def b(v):
    """SQL boolean literal from True/False-ish cells (or null when unknown)."""
    if v is None:
        return "null"
    t = str(v).strip().lower()
    if t in ("true", "yes", "y", "1"):
        return "true"
    if t in ("false", "no", "n", "0"):
        return "false"
    return "null"


def to_int(v):
    if v is None:
        return None
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def build_date(mo, day, yr):
    m, d, y = to_int(mo), to_int(day), to_int(yr)
    if not (m and d and y):
        return None
    if not (1 <= m <= 12 and 1 <= d <= 31 and 1900 <= y <= 2100):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def split_name(full):
    full = (full or "").strip()
    if not full:
        return None, None
    parts = full.split(" ", 1)
    if len(parts) == 1:
        return parts[0], None
    return parts[0], parts[1]


def cell(row, i):
    if 0 <= i < len(row):
        v = row[i]
        if v is None:
            return None
        v = str(v).strip()
        return v or None
    return None


def parse_row(row):
    """Extract a student record from a grid row, or None if not a student."""
    name = cell(row, 1)
    email = cell(row, 5)
    if not name or name.lower() in SKIP_NAMES:
        return None
    if not email or "@" not in email:
        return None  # need a real identity to track the profile

    rec = {
        "full_name": name,
        "email": email,
        "program_type": cell(row, 0),
        "location": cell(row, 2),
        "supervising_dvm": cell(row, 3),
        "weekday_schedule": cell(row, 4),
    }

    cells = [cell(row, i) for i in range(len(row))]

    # Anchor on the LAST "DVM 20XX" token — that's the Grad Year column.
    grad_idx = None
    for i in range(len(cells) - 1, 5, -1):
        if cells[i] and GRAD_RE.search(cells[i]):
            grad_idx = i
            break

    if grad_idx is not None:
        rec["grad_year"] = cells[grad_idx]
        # Trailing flags after grad year: stipend, completed, paid, cashed.
        rec["stipend"] = cells[grad_idx + 1] if grad_idx + 1 < len(cells) else None
        completed = b(cells[grad_idx + 2]) if grad_idx + 2 < len(cells) else "null"
        paid = b(cells[grad_idx + 3]) if grad_idx + 3 < len(cells) else "null"
        cashed = b(cells[grad_idx + 4]) if grad_idx + 4 < len(cells) else "null"
        if completed != "null":
            rec["completed"] = completed
        if paid != "null":
            rec["stipend_paid"] = paid
        if cashed != "null":
            rec["check_cashed"] = cashed

        # Six numeric date cells immediately before the grad-year anchor.
        date_cells = cells[max(6, grad_idx - 6):grad_idx]
        if len(date_cells) == 6 and all(c and NUMERIC_RE.match(c) for c in date_cells):
            rec["start_date"] = build_date(*date_cells[0:3])
            rec["end_date"] = build_date(*date_cells[3:6])
            mid_end = grad_idx - 6
        else:
            mid_end = grad_idx

        # Cells between email and the date block: doc-rec colour + free notes.
        notes = []
        for c in cells[6:mid_end]:
            if not c or NUMERIC_RE.match(c):
                continue
            if c.lower() in COLORS and "doc_recommendation" not in rec:
                rec["doc_recommendation"] = c
            elif "hire" in c.lower() and "hire_interest" not in rec:
                rec["hire_interest"] = c
            else:
                notes.append(c)
        if notes:
            rec["other_note"] = "; ".join(notes)

    return rec


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)

    # Preserve first-seen order while merging duplicates by email.
    students: dict[str, dict] = {}
    order: list[str] = []

    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        # Locate the header row ("Type" | "Name" | …) for this grid sheet.
        header_idx = None
        for i, row in enumerate(rows):
            c0 = cell(row, 0)
            c1 = cell(row, 1)
            if c0 and c1 and c0.lower() == "type" and c1.lower() == "name":
                header_idx = i
                break
        if header_idx is None:
            continue  # not a student grid sheet (e.g. Contacts)

        for row in rows[header_idx + 1:]:
            parsed = parse_row(row)
            if parsed is None:
                continue
            key = parsed["email"].lower()
            rec = students.get(key)
            if rec is None:
                students[key] = parsed
                order.append(key)
            else:
                # Later sheets fill in / override with non-empty values.
                for field, value in parsed.items():
                    if value not in (None, ""):
                        rec[field] = value

    wb.close()

    out = [
        "set search_path = greendogops, public;",
        f"delete from greendogops.crm_contact where source = '{SOURCE}';",
    ]
    for key in order:
        r = students[key]
        first, last = split_name(r.get("full_name"))
        eligible = "true" if "want to hire" in (r.get("hire_interest") or "").lower() else "null"
        out.append(
            "insert into greendogops.crm_contact "
            "(contact_type, first_name, last_name, full_name, email, location, "
            "program_type, supervising_dvm, weekday_schedule, doc_recommendation, "
            "hire_interest, grad_year, cohort, stipend, start_date, end_date, "
            "completed, stipend_paid, check_cashed, eligible_for_employment, "
            "notes, source) values ("
            f"'student', {s(first)}, {s(last)}, {s(r.get('full_name'))}, "
            f"{s(r.get('email'))}, {s(r.get('location'))}, {s(r.get('program_type'))}, "
            f"{s(r.get('supervising_dvm'))}, {s(r.get('weekday_schedule'))}, "
            f"{s(r.get('doc_recommendation'))}, {s(r.get('hire_interest'))}, "
            f"{s(r.get('grad_year'))}, {s(r.get('grad_year'))}, {s(r.get('stipend'))}, "
            f"{s(r.get('start_date'))}, {s(r.get('end_date'))}, "
            f"{r.get('completed', 'null')}, {r.get('stipend_paid', 'null')}, "
            f"{r.get('check_cashed', 'null')}, {eligible}, "
            f"{s(r.get('other_note'))}, '{SOURCE}');"
        )
    out.append(
        f"select count(*) as students from greendogops.crm_contact "
        f"where source = '{SOURCE}';"
    )
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
