"""
Seed ezyVet invoice-line reporting data from a monthly Invoice Lines CSV export
into greendogops.ezyvet_invoice_line. Emits SQL to stdout; pipe into
scripts/supabase-sql.sh.

Mirrors the normalization in src/lib/reporting/parse.ts (location, species,
dates) and dedups on the ezyVet "Invoice Line ID".

Usage:
    python3 scripts/import_ezyvet_invoices.py public/APRIL.csv > /tmp/inv.sql
    scripts/supabase-sql.sh -f /tmp/inv.sql
"""
import csv
import re
import sys

BATCH = 300


def s(v):
    if v is None:
        return "null"
    t = re.sub(r"\s+", " ", str(v)).strip()
    if t == "":
        return "null"
    return "'" + t.replace("'", "''") + "'"


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


def location(dept, inv):
    hay = f"{dept or ''} {inv or ''}".lower()
    if "sherman oaks" in hay:
        return "sherman_oaks", "Sherman Oaks"
    if "van nuys" in hay:
        return "van_nuys", "Van Nuys"
    if "venice" in hay:
        return "venice", "Venice"
    return "other", "Other"


def species_group(sp):
    if not sp:
        return "Unknown"
    x = sp.lower()
    if "canine" in x or "dog" in x:
        return "Dog"
    if "feline" in x or "cat" in x:
        return "Cat"
    return "Exotic"


COLS = (
    "invoice_line_id, invoice_no, invoice_date, line_date, line_type, "
    "department_raw, location_key, location_label, inventory_location, "
    "client_contact_code, business_name, first_name, last_name, email, "
    "animal_code, pet_name, species, species_group, breed, product_code, "
    "product_name, product_group, account, staff_member, staff_member_id, "
    "salesperson_is_vet, consult_id, qty, total_excl, total_incl"
)


def main(path):
    seen = set()
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            lid = (r.get("Invoice Line ID") or "").strip()
            if not lid or lid in seen:
                continue
            seen.add(lid)
            dept = r.get("Department")
            inv = r.get("Inventory Location")
            lkey, llabel = location(dept, inv)
            sp = r.get("Species")
            vals = [
                s(lid), s(r.get("Invoice #")), iso_date(r.get("Invoice Date")),
                iso_date(r.get("Invoice Line Date")), s(r.get("Type")),
                s(dept), s(lkey), s(llabel), s(inv),
                s(r.get("Client Contact Code")), s(r.get("Business Name")),
                s(r.get("First Name")), s(r.get("Last Name")), s(r.get("Email")),
                s(r.get("Animal Code")), s(r.get("Pet Name")), s(sp),
                s(species_group(sp)), s(r.get("Breed")), s(r.get("Product Code")),
                s(r.get("Product Name")), s(r.get("Product Group")),
                s(r.get("Account")), s(r.get("Staff Member")),
                s(r.get("Staff Member ID")), boolean(r.get("Salesperson is Vet")),
                s(r.get("Consult ID")), num(r.get("Qty")),
                num(r.get("Total Invoiced (excl)")),
                num(r.get("Total Invoiced (incl)")),
            ]
            rows.append("(" + ",".join(vals) + ")")

    print("set search_path = greendogops, public;")
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        print(f"insert into ezyvet_invoice_line ({COLS}) values")
        print(",\n".join(chunk))
        print("on conflict (invoice_line_id) do nothing;")
    print(f"-- {len(rows)} invoice lines from {path}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: import_ezyvet_invoices.py <file.csv>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1])
