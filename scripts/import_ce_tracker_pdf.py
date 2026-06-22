#!/usr/bin/env python3
"""Assimilate the GDU CE Tracker PDF into the CE CRM.

Source: public/GDU - CE Tracker - Registration Responses.pdf (a multi-tab
Google Sheets export of registrations, check-in rosters and Eventbrite payment
records for four Green Dog University CE events).
(The source PDF holds attendee PII and is kept in the gitignored .data/ folder,
not committed: .data/GDU - CE Tracker - Registration Responses.pdf)

The PDF text is messy/concatenated, so the per-attendee rosters below were read
and curated by hand. Email is the reliable identity key. This script emits SQL
that:
  1. Creates any CE leads (crm_contact, contact_type='ce_attendee') not already
     present, matched by lower(email) (or full name when no email).
  2. Upserts crm_ce_attendance rows per (lead, event): UPDATE flags onto an
     existing row (e.g. the legacy backfill rows) else INSERT a new one.

It is NON-DESTRUCTIVE and RE-RUNNABLE: existing rows are only enriched (flags are
OR'd on, dates filled only when blank), nothing is deleted.

Usage:
    python scripts/import_ce_tracker_pdf.py | ./scripts/supabase-sql.sh
"""
import sys

SOURCE_TAG = "ce_tracker_pdf_2026"

# Each attendee: (email, first, last, phone, paid, showed_up, confirmed_date)
# email may be None -> matched/created by full name instead.

EVENT_A = (
    "Advancements in Veterinary Dentistry (Apr 2025)",
    "2025-04-05",
    [
        ("draverayo@gmail.com", "Adrienne", "Verayo", "8189747963", True, True, "2025-04-03"),
        ("drmarcleobautista@gmail.com", "Marc Leo", "Bautista", "5629230763", True, True, "2025-04-02"),
        ("raclauswalker@gmail.com", "Rachel", "Leeson", "5202650216", True, True, "2025-03-23"),
        ("dlynnef98@gmail.com", "Diane", "Fahey", "2072333854", True, True, "2025-03-29"),
        ("rrizon@hotmail.com", "Robert", "Rizon", "9518581110", True, True, "2025-03-11"),
        ("DARVI.SERGIO@LABCORP.COM", "Darvi", "Sergio", "2054400990", True, True, "2025-03-07"),
        ("russell.nichols@labcorp.com", "Mark Russell", "Nichols", "9196021153", True, True, "2025-03-07"),
        ("h-letessier@hotmail.com", "Helene", "Dewynter", "8184515622", True, True, "2025-03-07"),
        ("rmcnv@yahoo.com", "Raymond", "De Villa", "3109865279", True, True, "2025-03-08"),
        ("greendogcelestine@gmail.com", "Celestine", "Hoh", "3104609439", True, True, "2025-03-19"),
        ("greendogsherry@gmail.com", "Sherry", "Vartanian", "4424521868", True, True, "2025-03-24"),
    ],
)

EVENT_B = (
    "Advanced Abdominal Ultrasound CE",
    "2025-10-04",
    [
        ("amv711uf@gmail.com", "Anthony", "Vartorella", "4408222127", True, True, None),
        ("greendogcelestine@gmail.com", "Celestine", "Hoh", "3104609439", True, True, None),
        ("Greendogdrclau@gmail.com", "Claudia", "Lau", "4244105139", True, True, None),
        ("drgallegos@msn.com", "Greg", "Gallegos", "6619655182", True, True, None),
        (None, "Leigh", "Gallegos", None, True, True, None),
        ("h-letessier@hotmail.com", "Helene", "Dewynter", "8184515622", True, True, None),
        ("idelpino@dvm.com", "Inez", "Del Pino", "5303045329", True, True, None),
        ("Jabardales4@gmail.com", "Jasmin", "Bardales", "8186310086", True, True, None),
        ("winstonweigand@gmail.com", 'John "Winston"', "Weigand", "3607908624", True, True, None),
        ("DocHalligan@dochalligan.com", "Karen", "Halligan", "3106256046", True, True, None),
        ("vetchae@gmail.com", "Michael", "Chae", "7472526524", False, True, None),
        ("porachoi@gmail.com", "Pora", "Choi", "7028831453", True, True, None),
        ("yoonleevet@gmail.com", "Yoonhyung", "Lee", "7145198222", True, True, None),
        ("heatherrally@gmail.com", "Heather", "Rally Webb", "3103099041", True, False, None),
        ("cyclinemma@mac.com", "Emma", "Kaiser", "8083430706", True, False, None),
        ("dgeekie@westernvetpartners.com", "Darlene", "Geekie", "8183378565", True, False, None),
    ],
)

EVENT_C = (
    "Fall Dentistry CE (Oct 2025)",
    "2025-10-29",
    [
        ("jearambulo@yahoo.com", "Elmer", "Arambulo", "5625057766", False, False, "2025-10-29"),
        ("wingarambulo@gmail.com", "Nelwina", "Arambulo", "5628221605", False, False, "2025-10-29"),
        ("candicehdvm@gmail.com", "Candice", "Habawel", "9512659015", False, False, "2025-10-29"),
        ("greendoglizbeth@gmail.com", "Lizbeth", "Gallegos", "4244101503", False, False, "2025-10-29"),
        ("mezti_alberto@hotmail.com", "Mezti", "Alberto", "3235722768", False, False, "2025-10-29"),
        ("greendogmezti@gmail.com", "Mezti", "Alberto", None, False, False, "2025-10-29"),
        ("greendognickb@gmail.com", "Nick", "Bermudez", "8184031941", False, False, "2025-10-29"),
        ("castrogladys20@gmail.com", "Gladys", "Castro Duenas", "3234957998", False, False, "2025-10-29"),
        ("greendogrvtjess@gmail.com", "Jessica", "Salazar", "8183211581", False, False, "2025-10-29"),
        ("greendogcelestine@gmail.com", "Celestine", "Hoh", "3104609439", False, False, "2025-10-29"),
        ("Dadmann76@gmail.com", "Manuel", "Boado", "5627736567", False, False, None),
        ("rvilla221@sbcglobal.net", "Rolando", "Villanueva", "8184585032", False, False, None),
        ("wramos6804@gmail.com", "Winston", "Ramos", "6264364922", False, False, None),
        ("roliza2@aol.com", "Rodolfo", "Lizardo", "4102073398", False, False, None),
    ],
)

EVENT_D = (
    "Ultrasound CE (July 2026)",
    None,  # upcoming; exact day TBD
    [
        ("simu2360@gmail.com", "Simone", "Trimm", "8182357100", False, False, None),
        ("nahmij@att.net", "Nahmi", "Jones", "8185994861", False, False, None),
        ("hsingdvm@encinovetcenter.com", "Tiffany", "Hsing", "6262352282", False, False, None),
        ("animuldoc@gmail.com", "Liz", "Friedman", "3233148536", False, False, None),
        ("greendogcelestine@gmail.com", "Celestine", "Hoh", "3104609439", False, False, None),
        ("greendogsherry@gmail.com", "Sherry", "Vartanian", "4424521868", True, False, None),
        ("kathrynschiller123@gmail.com", "Kathryn", "Schiller", "8184786165", False, False, None),
        ("Dvmdr1@gmail.com", "Teresa", "Long", "8183642394", False, False, None),
        ("drswope@sweethomevets.com", "Alexandra", "Swope", "8184388199", False, False, None),
        ("alexdelatorre23@gmail.com", "Alexandra", "De La Torre", "8188592721", False, False, None),
        ("susanofaie@charter.net", "Susan", "Ofsie", "3107179229", False, False, None),
        ("jessica.alexander@banfield.com", "Jessica", "Alexander", "8183887180", False, False, None),
        ("ave.andreavillarreal@gmail.com", "Andrea", "Villarreal", "2096959632", False, False, None),
        ("Castilloanimalvc@gmail.com", "Daniela", "Castillo", "6788770957", True, False, None),
        ("greendogdrniko@gmail.com", "Niko", "Alzate", "8184725996", True, False, None),
        ("dgeekie@westernvetpartners.com", "Darlene", "Geekie", "8183378565", True, False, None),
        ("Eddielamdvm@gmail.com", "Wai Hin", "Lam", "6263530588", True, False, None),
        (None, "SungYeop", "Kim", "2138581900", False, False, None),
        ("elizabeth@lcah.com", "Elizabeth", "Olken", "6036676397", True, False, None),
    ],
)

EVENTS = [EVENT_A, EVENT_B, EVENT_C, EVENT_D]

# Volunteers — created as leads so they exist in the CRM; no event attendance.
VOLUNTEERS = [
    ("dib.bagherinowrozani@westernu.edu", "Diba", "Bagheri-Nowrozani", None),
    ("Patrick.oleary@westernu.edu", "Patrick", "O'leary", None),
    ("alyssa.vu@westernu.edu", "Alyssa", "Vu", None),
]


def q(v):
    """SQL text literal (typed) or cast(null as text)."""
    if v is None or str(v).strip() == "":
        return "cast(null as text)"
    return "'" + str(v).strip().replace("'", "''") + "'"


def qd(v):
    """SQL date literal or cast(null as date)."""
    if not v:
        return "cast(null as date)"
    return f"date '{v}'"


def qb(v):
    return "true" if v else "false"


def main():
    rows = []  # imp CTE rows
    for ce_name, ce_date, attendees in EVENTS:
        for email, first, last, phone, paid, showed, confirmed in attendees:
            rows.append(
                "(" + ", ".join([
                    q(email), q(first), q(last), q(phone),
                    q(ce_name), qd(ce_date), qd(confirmed),
                    qb(paid), qb(showed),
                ]) + ")"
            )
    values_block = ",\n    ".join(rows)
    cte = (
        "imp(email, first_name, last_name, phone, ce_name, ce_date, "
        "confirmed_date, paid, showed_up) as (\n  values\n    "
        + values_block + "\n)"
    )

    # Volunteers VALUES
    vol_rows = [
        "(" + ", ".join([q(e), q(f), q(l), q(p)]) + ")"
        for e, f, l, p in VOLUNTEERS
    ]
    vol_block = ",\n    ".join(vol_rows)

    out = []
    out.append("set search_path = greendogops, public;")
    out.append("begin;")

    # 1) Create missing leads matched by email.
    out.append(f"""
-- 1) Create CE leads that don't already exist (matched by email).
with {cte}
insert into greendogops.crm_contact
  (contact_type, first_name, last_name, email, phone, status, lead_source, source)
select distinct on (lower(i.email))
  'ce_attendee', i.first_name, i.last_name, i.email, i.phone, 'attendee',
  'CE Tracker PDF Import', '{SOURCE_TAG}'
from imp i
where i.email is not null
  and not exists (
    select 1 from greendogops.crm_contact c
    where c.contact_type = 'ce_attendee' and lower(c.email) = lower(i.email)
  )
order by lower(i.email), i.confirmed_date nulls last;""")

    # 1b) Create missing leads that have NO email, matched by full name.
    out.append(f"""
-- 1b) Create email-less CE leads (matched by full name).
with {cte}
insert into greendogops.crm_contact
  (contact_type, first_name, last_name, phone, status, lead_source, source)
select distinct on (lower(i.first_name || ' ' || i.last_name))
  'ce_attendee', i.first_name, i.last_name, i.phone, 'attendee',
  'CE Tracker PDF Import', '{SOURCE_TAG}'
from imp i
where i.email is null
  and not exists (
    select 1 from greendogops.crm_contact c
    where c.contact_type = 'ce_attendee'
      and lower(coalesce(c.full_name, c.first_name || ' ' || c.last_name))
          = lower(i.first_name || ' ' || i.last_name)
  )
order by lower(i.first_name || ' ' || i.last_name);""")

    # 2) Update existing attendance rows (enrich flags/dates).
    out.append(f"""
-- 2) Enrich existing attendance rows (e.g. legacy backfill) with PDF data.
with {cte}
update greendogops.crm_ce_attendance a
set ce_date            = coalesce(a.ce_date, i.ce_date),
    confirmed_date     = coalesce(a.confirmed_date, i.confirmed_date),
    paid               = a.paid or i.paid,
    showed_up          = a.showed_up or i.showed_up
from imp i
join greendogops.crm_contact c
  on c.contact_type = 'ce_attendee'
 and (
   (i.email is not null and lower(c.email) = lower(i.email))
   or (i.email is null and lower(coalesce(c.full_name, c.first_name || ' ' || c.last_name))
        = lower(i.first_name || ' ' || i.last_name))
 )
where a.contact_id = c.id and a.ce_name = i.ce_name;""")

    # 3) Insert attendance rows that don't exist yet.
    out.append(f"""
-- 3) Insert attendance rows that don't exist yet.
with {cte}
insert into greendogops.crm_ce_attendance
  (contact_id, ce_name, ce_date, confirmed_date, paid, showed_up)
select distinct on (c.id, i.ce_name)
  c.id, i.ce_name, i.ce_date, i.confirmed_date, i.paid, i.showed_up
from imp i
join greendogops.crm_contact c
  on c.contact_type = 'ce_attendee'
 and (
   (i.email is not null and lower(c.email) = lower(i.email))
   or (i.email is null and lower(coalesce(c.full_name, c.first_name || ' ' || c.last_name))
        = lower(i.first_name || ' ' || i.last_name))
 )
where not exists (
  select 1 from greendogops.crm_ce_attendance a
  where a.contact_id = c.id and a.ce_name = i.ce_name
)
order by c.id, i.ce_name, i.confirmed_date nulls last;""")

    # 4) Create volunteer leads.
    out.append(f"""
-- 4) Create CE volunteer leads (WesternU); no event attendance attached.
with vol(email, first_name, last_name, phone) as (
  values
    {vol_block}
)
insert into greendogops.crm_contact
  (contact_type, first_name, last_name, email, phone, status, lead_source, notes, source)
select 'ce_attendee', v.first_name, v.last_name, v.email, v.phone, 'lead',
  'CE Volunteer (WesternU)', 'CE event volunteer', '{SOURCE_TAG}'
from vol v
where not exists (
  select 1 from greendogops.crm_contact c
  where c.contact_type = 'ce_attendee'
    and (
      lower(c.email) = lower(v.email)
      or lower(coalesce(c.full_name, c.first_name || ' ' || c.last_name))
         = lower(v.first_name || ' ' || v.last_name)
    )
);""")

    out.append("commit;")
    out.append("""
-- Summary
select ce_name,
       count(*) as attendees,
       count(*) filter (where paid) as paid,
       count(*) filter (where showed_up) as showed
from greendogops.crm_ce_attendance
group by ce_name
order by attendees desc;""")

    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
