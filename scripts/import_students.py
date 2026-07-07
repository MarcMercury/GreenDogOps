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

Rows are de-duplicated within the workbook by email (or, for the many upcoming
rotation students with no email captured yet, by normalised name); later sheets
fill in / override earlier ones so nothing is lost.

The emitted SQL does NOT blindly insert. It stages every parsed student, then
MATCHES each against existing contact_type='student' records (by email or
normalised name / prefix), ENRICHES the matched record in place — filling gaps
plus ratings, notes, dates and swapping placeholder @unknown.edu emails for the
real one, without clobbering a curated program_type/status — and only INSERTS
the students that match nothing as brand-new records. It runs in one
transaction and is safe to re-run.

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

# Rows whose "name" cell is a scheduling placeholder rather than a real person
# (empty holds, unfilled availability, section banners, running head-counts…).
# These must never become student records.
PLACEHOLDER_RE = re.compile(
    r"(?i)^\s*("
    r"\d+\s+students?"          # "16 students", "2 students avail"
    r"|.*students?\s+avail.*"    # "NO AVAIL NO STUDENTS", "2 students avail"
    r"|no avail.*"
    r"|hold for.*"               # "HOLD FOR STUDENT"
    r"|extra spot"
    r"|need"
    r"|none"
    r"|example.*"
    r"|examples above.*"
    r"|updated below"
    r"|completed below"
    r"|want to hire.*"
    r"|maybe hire"
    r"|not interested"
    r"|in process.*"
    r"|cancelled"
    r"|not given yet"
    r")\s*$"
)


def norm_name(name):
    """Normalised key for matching the same person across name-only / email rows."""
    n = re.sub(r"\([^)]*\)", " ", name or "")      # drop "(Webb)" nicknames
    n = re.sub(r"[^a-z\s]", " ", n.lower())        # letters + spaces only
    return re.sub(r"\s+", " ", n).strip()


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
    if not name or name.lower() in SKIP_NAMES or PLACEHOLDER_RE.match(name):
        return None

    email = cell(row, 5)
    if email and "@" not in email:
        email = None  # cells like "NOT GIVEN YET" / "APPROVED" aren't emails

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
            # Prefer email as the identity key; fall back to the name for the
            # many upcoming rotation students who have no email captured yet.
            if parsed.get("email"):
                key = parsed["email"].lower()
            else:
                key = "name:" + norm_name(parsed["full_name"])
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

    # Drop name-only records for people who also appear with an email, so the
    # richer email-keyed profile is the single record for that student.
    email_names = {
        norm_name(r["full_name"]) for r in students.values() if r.get("email")
    }
    order = [
        k
        for k in order
        if not (k.startswith("name:") and k[len("name:"):] in email_names)
    ]

    # ------------------------------------------------------------------
    # Emit a staging + reconciliation script. Rather than blindly inserting
    # (which duplicates students already tracked from other sources, e.g. the
    # curated student_program_view rows), we:
    #   1. stage every parsed grid student in a temp table,
    #   2. MATCH each against existing contact_type='student' records by email
    #      (case/space-insensitive) or normalised name (incl. prefix, to catch
    #      "Laura Callison" vs "Laura Callison (Webb)" and "Taylor Smallwood"
    #      vs "Taylor Smallwood 4th yr"),
    #   3. ENRICH the matched record in place (fill gaps + ratings/notes/dates,
    #      swap placeholder @unknown.edu emails for the real one) without
    #      clobbering its curated program_type/status,
    #   4. INSERT only the students that match nothing as brand-new records.
    # The whole thing runs in one transaction and is re-runnable (grid rows are
    # cleared first; enrichment uses coalesce so notes don't grow on re-run).
    # ------------------------------------------------------------------
    def val_row(r):
        first, last = split_name(r.get("full_name"))
        eligible = "true" if "want to hire" in (r.get("hire_interest") or "").lower() else "null"
        rec_color = (r.get("doc_recommendation") or "").lower() or None
        return (
            "("
            f"{s(r.get('full_name'))}, {s(first)}, {s(last)}, {s(r.get('email'))}, "
            f"{s(r.get('location'))}, {s(r.get('program_type'))}, "
            f"{s(r.get('supervising_dvm'))}, {s(r.get('weekday_schedule'))}, "
            f"{s(rec_color)}, {s(r.get('hire_interest'))}, {s(r.get('grad_year'))}, "
            f"{s(r.get('stipend'))}, {s(r.get('start_date'))}, {s(r.get('end_date'))}, "
            f"{r.get('completed', 'null')}, {r.get('stipend_paid', 'null')}, "
            f"{r.get('check_cashed', 'null')}, {s(r.get('other_note'))}, {eligible})"
        )

    values = ",\n  ".join(val_row(students[k]) for k in order)

    out = [
        "set search_path = greendogops, public;",
        "begin;",
        "",
        "-- Normalise a display name to a comparison key (drop nicknames/punctuation).",
        "create function pg_temp._norm(t text) returns text language sql immutable as $$",
        "  select trim(regexp_replace(",
        "    regexp_replace(",
        "      regexp_replace(lower(coalesce(t, '')), '\\([^)]*\\)', ' ', 'g'),",
        "      '[^a-z ]', ' ', 'g'),",
        "    '\\s+', ' ', 'g'))",
        "$$;",
        "",
        "create temp table _stg (",
        "  stg_id serial primary key,",
        "  full_name text, first_name text, last_name text, email text,",
        "  location text, program_type text, supervising_dvm text,",
        "  weekday_schedule text, doc_recommendation text, hire_interest text,",
        "  grad_year text, stipend text, start_date date, end_date date,",
        "  completed boolean, stipend_paid boolean, check_cashed boolean,",
        "  notes text, eligible boolean",
        ") on commit drop;",
        "",
        "insert into _stg (full_name, first_name, last_name, email, location,",
        "  program_type, supervising_dvm, weekday_schedule, doc_recommendation,",
        "  hire_interest, grad_year, stipend, start_date, end_date, completed,",
        "  stipend_paid, check_cashed, notes, eligible) values",
        f"  {values};",
        "",
        "-- Clear any prior grid import so this stays idempotent.",
        f"delete from greendogops.crm_contact where source = '{SOURCE}';",
        "",
        "-- Match staging rows to existing students (email OR normalised name/prefix).",
        "create temp table _match on commit drop as",
        "select s.stg_id, c.id as cid,",
        "       row_number() over (",
        "         partition by c.id",
        "         order by (s.doc_recommendation is not null) desc,",
        "                  s.start_date desc nulls last",
        "       ) as rn",
        "from _stg s",
        "join greendogops.crm_contact c",
        "  on c.contact_type = 'student'",
        " and (",
        "      (s.email is not null and c.email is not null",
        "         and lower(trim(s.email)) = lower(trim(c.email)))",
        "   or (pg_temp._norm(s.full_name) <> '' and (",
        "         pg_temp._norm(c.full_name) = pg_temp._norm(s.full_name)",
        "      or pg_temp._norm(c.full_name) like pg_temp._norm(s.full_name) || '%'",
        "      or pg_temp._norm(s.full_name) like pg_temp._norm(c.full_name) || '%'",
        "   ))",
        " );",
        "",
        "-- Enrich each matched existing student from its best-ranked staging row.",
        "update greendogops.crm_contact c set",
        "  email             = case when c.email is null or c.email like '%@unknown.edu'",
        "                             then coalesce(s.email, c.email) else c.email end,",
        "  location          = coalesce(nullif(trim(c.location), ''), s.location),",
        "  supervising_dvm   = coalesce(nullif(trim(c.supervising_dvm), ''), s.supervising_dvm),",
        "  weekday_schedule  = coalesce(nullif(trim(c.weekday_schedule), ''), s.weekday_schedule),",
        "  doc_recommendation= coalesce(nullif(trim(c.doc_recommendation), ''), s.doc_recommendation),",
        "  hire_interest     = coalesce(nullif(trim(c.hire_interest), ''), s.hire_interest),",
        "  grad_year         = coalesce(nullif(trim(c.grad_year), ''), s.grad_year),",
        "  cohort            = coalesce(nullif(trim(c.cohort), ''), s.grad_year),",
        "  stipend           = coalesce(nullif(trim(c.stipend), ''), s.stipend),",
        "  start_date        = coalesce(c.start_date, s.start_date),",
        "  end_date          = coalesce(c.end_date, s.end_date),",
        "  completed         = coalesce(c.completed, s.completed),",
        "  stipend_paid      = coalesce(c.stipend_paid, s.stipend_paid),",
        "  check_cashed      = coalesce(c.check_cashed, s.check_cashed),",
        "  notes             = coalesce(nullif(trim(c.notes), ''), s.notes),",
        "  updated_at        = now()",
        "from _match m",
        "join _stg s on s.stg_id = m.stg_id",
        "where c.id = m.cid and m.rn = 1;",
        "",
        "-- Insert the students that matched nothing as brand-new records.",
        "insert into greendogops.crm_contact",
        "  (contact_type, first_name, last_name, full_name, email, location,",
        "   program_type, supervising_dvm, weekday_schedule, doc_recommendation,",
        "   hire_interest, grad_year, cohort, stipend, start_date, end_date,",
        "   completed, stipend_paid, check_cashed, eligible_for_employment,",
        "   notes, source)",
        "select 'student', s.first_name, s.last_name, s.full_name, s.email,",
        "   s.location, s.program_type, s.supervising_dvm, s.weekday_schedule,",
        "   s.doc_recommendation, s.hire_interest, s.grad_year, s.grad_year,",
        "   s.stipend, s.start_date, s.end_date, s.completed, s.stipend_paid,",
        f"   s.check_cashed, nullif(s.eligible, false), s.notes, '{SOURCE}'",
        "from _stg s",
        "where not exists (select 1 from _match m where m.stg_id = s.stg_id);",
        "",
        "commit;",
        "",
        "select",
        "  (select count(*) from greendogops.crm_contact where contact_type='student') as total_students,",
        f"  (select count(*) from greendogops.crm_contact where source='{SOURCE}') as newly_added,",
        "  (select count(*) from greendogops.crm_contact where contact_type='student'"
        " and doc_recommendation is not null) as with_rating;",
    ]
    sys.stdout.write("\n".join(out) + "\n")



if __name__ == "__main__":
    main()
