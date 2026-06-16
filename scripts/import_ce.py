#!/usr/bin/env python3
"""Parse the CE attendees CSV and emit SQL inserts into greendogops.crm_contact."""
import csv
import sys
from datetime import datetime

SRC = ".data/CE Atendees_2026-06-16.xlsx"  # actually a UTF-8 CSV


def s(v):
    if v is None:
        return "null"
    v = str(v).strip()
    if v == "":
        return "null"
    return "'" + v.replace("'", "''") + "'"


def d(v):
    if not v or not str(v).strip():
        return "null"
    raw = str(v).strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return "'" + datetime.strptime(raw, fmt).strftime("%Y-%m-%d") + "'"
        except ValueError:
            continue
    return "null"


def main():
    with open(SRC, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    out = [
        "set search_path = greendogops, public;",
        "delete from greendogops.crm_contact where source = 'ce_csv';",
    ]
    for r in rows:
        first = (r.get("First Name") or "").strip()
        last = (r.get("Last Name") or "").strip()
        if not first and not last:
            continue
        out.append(
            "insert into greendogops.crm_contact "
            "(contact_type, first_name, last_name, email, phone, visitor_type, "
            "organization, school, program_name, start_date, end_date, location, "
            "status, coordinator, mentor, ce_events_attended, lead_source, notes, source) "
            "values ("
            f"'ce_attendee', {s(first)}, {s(last)}, {s(r.get('Email'))}, "
            f"{s(r.get('Phone'))}, {s(r.get('Visitor Type'))}, "
            f"{s(r.get('Organization'))}, {s(r.get('School'))}, {s(r.get('Program'))}, "
            f"{d(r.get('Visit Start'))}, {d(r.get('Visit End'))}, {s(r.get('Location'))}, "
            f"{s(r.get('Status'))}, {s(r.get('Coordinator'))}, {s(r.get('Mentor'))}, "
            f"{s(r.get('CE Events Attended'))}, {s(r.get('Lead Source'))}, "
            f"{s(r.get('Notes'))}, 'ce_csv');"
        )
    out.append(
        "select count(*) as ce_attendees from greendogops.crm_contact "
        "where source = 'ce_csv';"
    )
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
