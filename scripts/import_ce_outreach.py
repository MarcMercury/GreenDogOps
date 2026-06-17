#!/usr/bin/env python3
"""Parse the "CE Outreach Contact List" workbook and emit SQL inserts into
greendogops.crm_contact as ce_attendee leads.

The workbook is a CE-event outreach list (Green Dog University). "ALL CONTACTS"
is the master de-duped list; the other sheets enrich individual people with CE
registrations, DVM license numbers, clinics, states and provenance. We merge all
sheets keyed by email (falling back to name) into one record per person, then
emit NON-DESTRUCTIVE, RE-RUNNABLE inserts guarded by NOT EXISTS so we never
duplicate a person who is already in crm_contact (any source).

Usage:
    python scripts/import_ce_outreach.py | ./scripts/supabase-sql.sh
"""
import re
import sys

import openpyxl

SRC = ".data/CE Outreach Contact List_2026-06-17.xlsx"
SOURCE_TAG = "ce_outreach_2026"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
TITLE_RE = re.compile(r"^(dr|dr\.|mr|mr\.|mrs|mrs\.|ms|ms\.)\s+", re.IGNORECASE)
CRED_RE = re.compile(
    r"\b(DVM|VMD|RVT|CVT|LVT|VTS|DACVR|DACVIM|DACVECC|CVET|RDH|RN|MS|USDA)\b",
    re.IGNORECASE,
)


def cell(v):
    if v is None:
        return ""
    s = str(v).replace("\u00a0", " ").strip()
    return s


def norm_email(v):
    s = cell(v)
    if not s:
        return None
    m = EMAIL_RE.search(s)
    return m.group(0).lower() if m else None


def clean_phone(v):
    s = cell(v)
    if not s:
        return None
    s = re.sub(r"\.0$", "", s)  # xlsx float artifact
    if not re.search(r"\d", s):
        return None
    return s


def parse_name(raw):
    """Return (full_name, first, last, credential)."""
    full = re.sub(r"\s+", " ", cell(raw)).strip(" \"'")
    if not full:
        return None, None, None, None
    cred = None
    cm = CRED_RE.search(full)
    if cm:
        cred = cm.group(0).upper()
    # drop credential / trailing descriptor after a comma
    core = full.split(",")[0].strip()
    core = TITLE_RE.sub("", core).strip()
    core = re.sub(r"\([^)]*\)", " ", core)  # drop (nicknames)
    core = re.sub(r"[\"'`]", " ", core)
    core = re.sub(r"\s+", " ", core).strip()
    tokens = [t for t in core.split(" ") if t]
    first = tokens[0] if tokens else None
    last = tokens[-1] if len(tokens) > 1 else None
    return full, first, last, cred


class Rec:
    __slots__ = (
        "email", "full_name", "first", "last", "phone", "organization",
        "location", "lead_source", "ce_events", "status", "credential", "notes",
        "namekey",
    )

    def __init__(self):
        self.email = None
        self.full_name = None
        self.first = None
        self.last = None
        self.phone = None
        self.organization = None
        self.location = None
        self.lead_source = None
        self.ce_events = None
        self.status = None
        self.credential = None
        self.notes = []
        self.namekey = None


STATUS_RANK = {None: 0, "lead": 1, "unsubscribed": 2, "registrant": 3, "attendee": 4}

records = {}


def key_for(email, full_name):
    if email:
        return email
    nk = re.sub(r"[^a-z]", "", (full_name or "").lower())
    return "name:" + nk if nk else None


def get(email, full_name):
    k = key_for(email, full_name)
    if not k:
        return None
    r = records.get(k)
    if r is None:
        r = Rec()
        records[k] = r
    return r


def setfirst(r, attr, val):
    if val and not getattr(r, attr):
        setattr(r, attr, val)


def set_status(r, status):
    if STATUS_RANK.get(status, 0) > STATUS_RANK.get(r.status, 0):
        r.status = status


def add_note(r, note):
    note = cell(note)
    if note and note not in r.notes:
        r.notes.append(note)


def add_person(email, name_raw, *, phone=None, organization=None, location=None,
               lead_source=None, ce_events=None, status=None, credential=None,
               notes=None):
    full, first, last, cred = parse_name(name_raw)
    r = get(email, full)
    if r is None:
        return
    if email:
        r.email = email
    setfirst(r, "full_name", full)
    setfirst(r, "first", first)
    setfirst(r, "last", last)
    setfirst(r, "phone", clean_phone(phone))
    setfirst(r, "organization", cell(organization) or None)
    setfirst(r, "location", cell(location) or None)
    setfirst(r, "lead_source", cell(lead_source) or None)
    setfirst(r, "ce_events", cell(ce_events) or None)
    setfirst(r, "credential", credential or cred)
    if status:
        set_status(r, status)
    for n in (notes or []):
        add_note(r, n)


def main():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

    def rows(sheet):
        return list(wb[sheet].iter_rows(values_only=True))

    # ---- ALL CONTACTS (master) --------------------------------------------
    do_not_email = False
    for row in rows("ALL CONTACTS")[2:]:
        row = list(row) + [None] * 6
        text0 = cell(row[0])
        if "DO NOT EMAIL" in text0.upper() or "UNSCUBSCRIB" in text0.upper() \
                or "UNSUBSCRIB" in text0.upper():
            do_not_email = True
            continue
        email = norm_email(row[0])
        name = cell(row[1])
        if not email and not name:
            continue
        phone = clean_phone(row[2])
        clinic = cell(row[3])
        assoc = cell(row[4])
        group = cell(row[5])
        lead = " / ".join(x for x in (assoc, group) if x) or None
        notes = []
        if clinic and not phone and not re.search(r"\d{3}", clinic):
            pass
        add_person(
            email, name, phone=phone, organization=clinic or None,
            lead_source=lead, status="unsubscribed" if do_not_email else "lead",
            notes=notes,
        )
        if do_not_email:
            r = get(email, parse_name(name)[0])
            if r:
                add_note(r, "UNSUBSCRIBED — do not email")

    # ---- Sheet7: part A registrants + part B registration form ------------
    mode = "a"
    for row in rows("Sheet7"):
        c = [cell(x) for x in row] + [""] * 9
        if c[0].lower().startswith("first name"):
            mode = "a"
            continue
        if c[0].lower().startswith("first & last") or "attendee" in c[0].lower():
            mode = "b"
            continue
        if mode == "a":
            first, last, email, state, lead = c[0], c[1], c[2], c[3], c[4]
            if not (first or last):
                continue
            name = (first + " " + last).strip()
            add_person(
                norm_email(email), name, location=state or None,
                lead_source=lead or "Abdominal Ultrasound CE",
                ce_events="Abdominal Ultrasound CE", status="registrant",
            )
        else:  # registration form
            name, email, phone, clinic = c[0], c[1], c[2], c[3]
            diet, allerg, heard, comments, conf = c[4], c[5], c[6], c[7], c[8]
            if not name:
                continue
            notes = []
            if diet and diet.lower() not in ("none", "no", "n/a", "na"):
                notes.append(f"Dietary: {diet}")
            if allerg and allerg.lower() not in ("none", "no", "n/a", "na"):
                notes.append(f"Allergies: {allerg}")
            if comments:
                notes.append(comments)
            if conf:
                notes.append(f"Confirmation: {conf}")
            add_person(
                norm_email(email), name, phone=phone, organization=clinic or None,
                lead_source=heard or None, ce_events="GDU CE Event",
                status="attendee", notes=notes,
            )

    # ---- 2023 Viticus Basic Abdominal Ultrasound --------------------------
    for row in rows("2023 Viticus 29271 Basic Abdomi"):
        c = [cell(x) for x in row] + [""] * 5
        if not c[3] or "@" not in c[3]:
            # columns: Title | First | Last | Email | State
            if not (c[1] and c[2]) or "@" not in (c[3] or ""):
                continue
        title, first, last, email, state = c[0], c[1], c[2], c[3], c[4]
        if not (first or last):
            continue
        name = (f"{title} " if title else "") + f"{first} {last}".strip()
        add_person(
            norm_email(email), name.strip(), location=state or None,
            lead_source="2023 Viticus Basic Abdominal Ultrasound CE",
            ce_events="Abdominal Ultrasound CE", status="registrant",
        )

    # ---- 2024 Viticus Advanced AUS CE -------------------------------------
    for row in rows("2024 Viticus Advanced AUS CE"):
        c = [cell(x) for x in row] + [""] * 4
        # columns: Last | First | DVM License | Email
        if "@" not in (c[3] or ""):
            continue
        last, first, lic, email = c[0], c[1], c[2], c[3]
        if not (first or last):
            continue
        lic = re.sub(r"\.0$", "", lic) if lic else ""
        notes = [f"DVM License: {lic}"] if lic and lic.lower() != "united states" else []
        name = f"{first} {last}".strip()
        add_person(
            norm_email(email), name, location=None,
            lead_source="2024 Viticus Advanced Abdominal Ultrasound CE",
            ce_events="Advanced Abdominal Ultrasound CE", status="registrant",
            notes=notes,
        )

    # ---- Local Veterinary People (LinkedIn outreach) ----------------------
    for row in rows("Local Veterinary People")[7:]:
        c = [cell(x) for x in row] + [""] * 12
        name = c[0]
        if not name:
            continue
        event = c[1]
        going = c[2]
        email = norm_email(c[4])
        phone = clean_phone(c[6])
        clinic = c[8]
        cred = c[10]
        if cred and cred.upper() in ("N/A", "NA"):
            cred = ""
        notes = []
        if not email and c[4] and c[4].lower() not in ("no info found",):
            notes.append(f"Contact: {c[4]}")
        status = "registrant" if going.lower() == "yes" else "lead"
        add_person(
            email, name, phone=phone,
            organization=clinic if clinic and len(clinic) < 60 else None,
            lead_source=event or "LinkedIn outreach", ce_events=event or None,
            status=status, credential=cred or None, notes=notes,
        )
        if clinic and len(clinic) >= 60:
            r = get(email, parse_name(name)[0])
            if r:
                add_note(r, clinic)

    wb.close()

    # ---- emit SQL ----------------------------------------------------------
    def s(v):
        if v is None or v == "":
            return "null"
        text = re.sub(r"\s+", " ", str(v)).strip()
        if text == "":
            return "null"
        return "'" + text.replace("'", "''") + "'"

    out = ["set search_path = greendogops, public;"]
    n = 0
    skipped = 0
    for r in records.values():
        if not (r.email or r.full_name):
            continue
        # Skip uncontactable cold names: no email, no phone, and never engaged
        # (mostly "No reply" LinkedIn targets we have no way to reach).
        if not r.email and not r.phone and (r.status or "lead") == "lead":
            skipped += 1
        if not (r.email or r.full_name):
            continue
        # Skip uncontactable cold names: no email, no phone, and never engaged
        # (these are mostly "No reply" LinkedIn targets with no way to reach them).
        if not r.email and not r.phone and (r.status or "lead") == "lead":
            skipped += 1
            continue
        n += 1
        notes = list(r.notes)
        if r.credential:
            notes.insert(0, f"Credential: {r.credential}")
        notes_str = " | ".join(notes) if notes else None
        if r.email:
            guard = (
                "where not exists (select 1 from greendogops.crm_contact c "
                f"where lower(c.email) = lower({s(r.email)}))"
            )
        else:
            guard = (
                "where not exists (select 1 from greendogops.crm_contact c "
                f"where c.email is null and lower(c.full_name) = lower({s(r.full_name)}))"
            )
        out.append(
            "insert into greendogops.crm_contact "
            "(contact_type, first_name, last_name, full_name, email, phone, "
            "status, organization, location, ce_events_attended, lead_source, "
            "notes, source) "
            "select 'ce_attendee', "
            f"{s(r.first)}, {s(r.last)}, {s(r.full_name)}, {s(r.email)}, "
            f"{s(r.phone)}, {s(r.status or 'lead')}, {s(r.organization)}, "
            f"{s(r.location)}, {s(r.ce_events)}, {s(r.lead_source)}, "
            f"{s(notes_str)}, '{SOURCE_TAG}' "
            f"{guard};"
        )
    out.append(        "select count(*) filter (where source = '" + SOURCE_TAG + "') as imported, "
        "count(*) filter (where contact_type = 'ce_attendee') as total_ce "
        "from greendogops.crm_contact;"
    )
    sys.stdout.write("\n".join(out) + "\n")
    sys.stderr.write(f"parsed {n}, skipped {skipped} uncontactable, from {SRC}\n")


if __name__ == "__main__":
    main()
