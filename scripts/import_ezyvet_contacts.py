"""
Seed ezyVet CRM contacts from a Contacts CSV export into
greendogops.ezyvet_contact. Emits SQL to stdout; pipe into
scripts/supabase-sql.sh. Dedups/upserts on the ezyVet "Contact Id".

Usage:
    python3 scripts/import_ezyvet_contacts.py "public/Contacts 6-5.csv" > /tmp/c.sql
    scripts/supabase-sql.sh -f /tmp/c.sql
"""
import csv
import re
import sys

BATCH = 300


def s(v):
    if v is None:
        return "null"
    t = re.sub(r"\s+", " ", str(v)).strip()
    return "null" if t == "" else "'" + t.replace("'", "''") + "'"


def num(v):
    if v is None:
        return "null"
    t = str(v).strip().replace("$", "").replace(",", "")
    if t == "":
        return "null"
    try:
        return repr(float(t))
    except ValueError:
        return "null"


def boolean(v):
    if v is None:
        return "null"
    u = str(v).strip().upper()
    if u in ("YES", "TRUE", "1", "Y"):
        return "true"
    if u in ("NO", "FALSE", "0", "N"):
        return "false"
    return "null"


def iso_date(v):
    if not v:
        return "null"
    t = str(v).strip()
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", t)
    if m:
        mm, dd, yyyy = m.groups()
        return f"'{yyyy}-{int(mm):02d}-{int(dd):02d}'"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"'{m.group(1)}-{m.group(2)}-{m.group(3)}'"
    return "null"


def iso_ts(v):
    if not v:
        return "null"
    t = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", t)
    if m:
        return f"'{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}Z'"
    d = iso_date(t)
    return f"'{d[1:-1]}T00:00:00Z'" if d != "null" else "null"


COLS = (
    "ezyvet_contact_id, contact_code, business_name, title, first_name, "
    "last_name, full_name, date_of_birth, is_customer, is_business, is_vet, "
    "is_active, is_supplier, preferred_contact_method, physical_street1, "
    "physical_street2, physical_city, physical_state, physical_post_code, "
    "physical_country, number_of_miles, email, phone, mobile, website, notes, "
    "account_code, last_invoiced, staff_member, hear_about, customer_group, "
    "regional_group, division, revenue_spend_ytd, opt_out_marketing, "
    "ezyvet_created_at, ezyvet_created_by, ezyvet_modified_at, ezyvet_modified_by"
)

UPDATE_SET = ",".join(
    f"{c}=excluded.{c}"
    for c in (
        "contact_code business_name title first_name last_name full_name "
        "date_of_birth is_customer is_business is_vet is_active is_supplier "
        "preferred_contact_method physical_street1 physical_street2 "
        "physical_city physical_state physical_post_code physical_country "
        "number_of_miles email phone mobile website notes account_code "
        "last_invoiced staff_member hear_about customer_group regional_group "
        "division revenue_spend_ytd opt_out_marketing ezyvet_created_at "
        "ezyvet_created_by ezyvet_modified_at ezyvet_modified_by"
    ).split()
) + ",updated_at=now()"


def main(path):
    seen = set()
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            cid = (r.get("Contact Id") or "").strip()
            if not cid or cid in seen:
                continue
            seen.add(cid)
            first = (r.get("Contact First Name") or "").strip()
            last = (r.get("Contact Last Name") or "").strip()
            business = (r.get("Business Name") or "").strip()
            full = " ".join(x for x in (first, last) if x).strip() or business
            vals = [
                s(cid), s(r.get("Contact Code")), s(business),
                s(r.get("Contact Title")), s(first), s(last), s(full),
                iso_date(r.get("Contact Date of Birth")),
                boolean(r.get("Contact Is Customer")),
                boolean(r.get("Contact Is Business")),
                boolean(r.get("Contact Is Vet")),
                boolean(r.get("Contact Is Active")),
                boolean(r.get("Contact Is Supplier")),
                s(r.get("Contact Preferred Contact Method")),
                s(r.get("Contact Physical Street Line 1")),
                s(r.get("Contact Physical Street Line 2")),
                s(r.get("Contact Physical City")),
                s(r.get("Contact Physical State")),
                s(r.get("Contact Physical Post Code")),
                s(r.get("Contact Physical Country")),
                num(r.get("Number of Miles")),
                s(r.get("Email Addresses")), s(r.get("Phone Numbers")),
                s(r.get("Mobile Numbers")), s(r.get("Contact Website Address")),
                s(r.get("Contact Notes")), s(r.get("Contact Account Code")),
                iso_date(r.get("Last Invoiced")),
                s(r.get("Contact Staff Member")),
                s(r.get("Contact Hear About Option")),
                s(r.get("Customer Group")),
                s(r.get("Contact Regional Contact Group")),
                s(r.get("Contact Division")),
                num(r.get("Revenue Spend YTD")),
                boolean(r.get("Opt Out of Electronic Marketing")),
                iso_ts(r.get("Contact Created At")),
                s(r.get("Contact Created By")),
                iso_ts(r.get("Contact Modified At")),
                s(r.get("Contact Modified By")),
            ]
            rows.append("(" + ",".join(vals) + ")")

    print("set search_path = greendogops, public;")
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        print(f"insert into ezyvet_contact ({COLS}) values")
        print(",\n".join(chunk))
        print(f"on conflict (ezyvet_contact_id) do update set {UPDATE_SET};")
    print(f"-- {len(rows)} contacts from {path}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: import_ezyvet_contacts.py <file.csv>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1])
