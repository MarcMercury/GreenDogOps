#!/usr/bin/env python3
"""Import vendor accounts / logins / contacts from the three spreadsheets the
user dropped in public/ (now moved to .data/):

  1. Historic Passwords.xlsx
  2. MANAGERS - Office Supplies_Vendors_Accounts (1).xlsx
  3. Vendor Contacts.xlsx

It emits SQL that:
  * fills greendogops.credential (the admin-only vault) with every login /
    account / password / extension found, and
  * enriches greendogops.crm_organization vendor rows with newly-found details
    (account #, rep contact, phone, email, website, notes) — updating existing
    records where the name matches, inserting new vendors otherwise.

Re-runnable: clears its own prior rows (source = 'vendor_import') first, and the
CRM enrichment only fills NULL columns (never clobbers existing data).

Usage:  python scripts/import_vendor_data.py | ./scripts/supabase-sql.sh
"""
import json
import re
import sys

import openpyxl

DATA = ".data"
F_HIST = f"{DATA}/Historic Passwords.xlsx"
F_MGR = f"{DATA}/MANAGERS - Office Supplies_Vendors_Accounts (1).xlsx"
F_VEND = f"{DATA}/Vendor Contacts.xlsx"
EXISTING = f"{DATA}/_existing_orgs.json"

SOURCE = "vendor_import"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def q(v):
    """SQL-quote a string/None."""
    if v is None:
        return "null"
    v = str(v).strip()
    if v == "" or v.lower() in ("na", "n/a", "none"):
        return "null"
    return "'" + v.replace("'", "''") + "'"


def clean(v):
    if v is None:
        return None
    v = str(v).replace("\n", " ").strip()
    return v or None


def is_url(v):
    if not v:
        return False
    v = str(v).strip().lower()
    return v.startswith("http") or bool(re.search(r"[a-z0-9-]+\.[a-z]{2,}", v))


def is_section(cells):
    """A divider/section row: only the first cell has content."""
    first = clean(cells[0]) if cells else None
    rest = [clean(c) for c in cells[1:]]
    return bool(first) and not any(rest)


def joined_notes(*parts):
    out = []
    for p in parts:
        p = clean(p)
        if p:
            out.append(p)
    return " | ".join(out) if out else None


def rows(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    data = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return data


# ---------------------------------------------------------------------------
# credential accumulator
# ---------------------------------------------------------------------------
CREDS = []


def cred(**kw):
    # require at least one meaningful field beyond the label
    if not kw.get("label"):
        return
    keys = ("username", "password", "account_number", "url", "contact_phone",
            "contact_email", "contact_name")
    if not any(clean(kw.get(k)) for k in keys):
        return
    CREDS.append(kw)


# ---------------------------------------------------------------------------
# 1. Historic Passwords  (sheet: Jackpw)
#    ctr | Link | User | Pw | Account number | Remarks
# ---------------------------------------------------------------------------
def parse_historic():
    for r in rows(F_HIST, "Jackpw")[1:]:
        r = (list(r) + [None] * 6)[:6]
        label = clean(r[0])
        if not label:
            continue
        cred(
            category="legacy",
            label=label,
            url=clean(r[1]),
            username=clean(r[2]),
            password=clean(r[3]),
            account_number=clean(r[4]),
            status=clean(r[5]),
            owner_scope="Historic / legacy list",
        )


# ---------------------------------------------------------------------------
# 2a. MANAGERS ONLY PASSWORDS
#     ACCOUNT | WEBSITE | USERNAME | PASSWORD | NOTES
# ---------------------------------------------------------------------------
SECTION_CATEGORY = {
    "EMAILS": "internal_email",
    "VONAGE": "phone_system",
    "TEXTING": "software",
    "SCRITCH-EMILY AI": "software",
    "COVETRUS": "vendor",
    "VIDEO CALL": "software",
    "MERCHANTS / SOCIALS / RESOURCE": "software",
    "LABRATORY": "lab",
    "USDA": "lab",
    "VET CONNECT": "software",
    "ALL LOCATIONS WIFI": "wifi",
    "OTHER ACCOUNTS": "vendor",
    "EZYVET USERS": "ezyvet",
    "INACTIVE USERS": "ezyvet",
    "IMPORTANT DOCUMENTS & GRIDS": "software",
    "MARKETING": "software",
}


def parse_managers_passwords():
    data = rows(F_MGR, "MANAGERS ONLY PASSWORDS")
    category = "software"
    location = None
    for r in data[1:]:
        r = (list(r) + [None] * 5)[:5]
        cells = r
        if is_section(cells):
            key = clean(cells[0]).upper()
            category = SECTION_CATEGORY.get(key, category)
            # Wi-Fi location sub-headers
            if category == "wifi":
                location = clean(cells[0])
            continue
        label = clean(r[0])
        if not label:
            continue
        col1 = clean(r[1])
        url = col1 if is_url(col1) else None
        extra = None if is_url(col1) else col1
        cred(
            category=category,
            label=label,
            url=url,
            username=clean(r[2]),
            password=clean(r[3]),
            notes=joined_notes(extra, r[4]),
            location=location if category == "wifi" else None,
            owner_scope="Managers only",
        )


# ---------------------------------------------------------------------------
# 2b. RETAIL WEBSITES & VENDORS
#  COMPANY | CONTACT | PHONE | EMAIL/USER | PASSWORD | WEBSITE | ADDRESS | ACCT# | NOTES
# ---------------------------------------------------------------------------
def parse_retail():
    data = rows(F_MGR, "RETAIL WEBSITES & VENDORS")
    section = "RETAIL"
    for r in data[1:]:
        r = (list(r) + [None] * 9)[:9]
        if is_section(r):
            section = clean(r[0]).upper()
            continue
        label = clean(r[0])
        if not label:
            continue
        cat = "retail" if section == "RETAIL" else "vendor"
        cred(
            category=cat,
            label=label,
            service=label,
            contact_name=clean(r[1]),
            contact_phone=clean(r[2]),
            username=clean(r[3]),
            password=clean(r[4]),
            url=clean(r[5]),
            account_number=clean(r[7]),
            notes=joined_notes(r[6], r[8]),
            owner_scope="Managers only",
        )
        VENDOR_ENRICH.append(dict(
            name=label, org_type="med_ops", allow_insert=True,
            contact_name=clean(r[1]), phone=clean(r[2]),
            email=clean(r[3]) if "@" in str(r[3] or "") else None,
            website=clean(r[5]), account_number=clean(r[7]),
            notes=joined_notes(r[6], r[8]),
        ))


# ---------------------------------------------------------------------------
# 2c. HANDYMEN-PLIUMBERS-Utilities  -> facility_resource (no passwords)
#     SERVICE | NAME | Locations | NUMBER | EMAIL | NOTE
# ---------------------------------------------------------------------------
def parse_handymen():
    for r in rows(F_MGR, "HANDYMEN-PLIUMBERS-Utilities")[1:]:
        r = (list(r) + [None] * 6)[:6]
        name = clean(r[1])
        if not name:
            continue
        VENDOR_ENRICH.append(dict(
            name=name, org_type="facility_resource", allow_insert=True,
            services=clean(r[0]), area=clean(r[2]), phone=clean(r[3]),
            email=clean(r[4]), notes=clean(r[5]),
        ))


# ---------------------------------------------------------------------------
# 2d. Aetna Technical : Room/Item | Login | Password | Note
# ---------------------------------------------------------------------------
def parse_aetna_tech():
    for r in rows(F_MGR, "Aetna Technical")[1:]:
        r = (list(r) + [None] * 4)[:4]
        label = clean(r[0])
        if not label:
            continue
        cred(
            category="technical",
            label=label,
            location="AETNA",
            username=clean(r[1]),
            password=clean(r[2]),
            notes=clean(r[3]),
            owner_scope="Managers only",
        )


# ---------------------------------------------------------------------------
# 3a. Vendor Contacts -> Contacts
#  Vendor|forms|Misc|Contact|Email|Phone|Acct#|Website|UserID|Password|Order|Pay|Notes|...
# ---------------------------------------------------------------------------
def parse_vendor_contacts():
    data = rows(F_VEND, "Contacts")
    # header is row index 1
    for r in data[2:]:
        r = (list(r) + [None] * 17)[:17]
        if is_section(r):
            continue
        label = clean(r[0])
        if not label:
            continue
        cred(
            category="vendor",
            label=label,
            service=label,
            contact_name=clean(r[3]),
            contact_email=clean(r[4]),
            contact_phone=clean(r[5]),
            account_number=clean(r[6]),
            url=clean(r[7]),
            username=clean(r[8]),
            password=clean(r[9]),
            order_method=clean(r[10]),
            payment_method=clean(r[11]),
            notes=joined_notes(r[2], r[12]),
            owner_scope="Deija & CE",
        )
        VENDOR_ENRICH.append(dict(
            name=label, org_type="med_ops", allow_insert=False,
            contact_name=clean(r[3]), email=clean(r[4]), phone=clean(r[5]),
            account_number=clean(r[6]), website=clean(r[7]),
            notes=joined_notes(r[2], r[12]),
        ))


# ---------------------------------------------------------------------------
# 3b. Vendor Contacts -> Updated Contacts Feb 2026
#  VENDOR|INFO|FORM|DATE|ACCT|LOC|DEPT|COSTS|CCFEES|WEBSITE|USER|PW|CNAME|CEM|CPH|BROWSER|MISC|MISC
# ---------------------------------------------------------------------------
def parse_vendor_updated():
    data = rows(F_VEND, "Updated Contacts Feb 2026")
    for r in data[2:]:
        r = (list(r) + [None] * 18)[:18]
        if is_section(r):
            continue
        label = clean(r[0])
        if not label:
            continue
        cred(
            category="vendor",
            label=label,
            service=label,
            account_number=clean(r[4]),
            location=clean(r[5]),
            url=clean(r[9]),
            username=clean(r[10]),
            password=clean(r[11]),
            contact_name=clean(r[12]),
            contact_email=clean(r[13]),
            contact_phone=clean(r[14]),
            notes=joined_notes(r[1], r[15], r[16], r[17]),
            owner_scope="Deija & CE",
        )
        VENDOR_ENRICH.append(dict(
            name=label, org_type="med_ops", allow_insert=False,
            contact_name=clean(r[12]), email=clean(r[13]), phone=clean(r[14]),
            account_number=clean(r[4]), website=clean(r[9]),
            notes=joined_notes(r[1], r[16], r[17]),
        ))


# ---------------------------------------------------------------------------
# 3c. Vendor Contacts -> Facility & Maint.
#     Type | Location | Name | Number | Email | Notes
# ---------------------------------------------------------------------------
def parse_facility():
    for r in rows(F_VEND, "Facility & Maint.")[1:]:
        r = (list(r) + [None] * 6)[:6]
        name = clean(r[2])
        if not name:
            continue
        VENDOR_ENRICH.append(dict(
            name=name, org_type="facility_resource", allow_insert=True,
            services=clean(r[0]), area=clean(r[1]), phone=clean(r[3]),
            email=clean(r[4]), website=None, notes=clean(r[5]),
        ))


# ---------------------------------------------------------------------------
# CRM enrichment matching
# ---------------------------------------------------------------------------
VENDOR_ENRICH = []


def norm(name):
    if not name:
        return ""
    n = name.lower()
    n = re.sub(r"\(.*?\)", " ", n)           # drop parentheticals
    n = n.replace("&", " and ").replace(" dot ", " ")
    # strip lab-portal prefixes / noise so they match existing CRM names
    n = re.sub(r"^lab geist\s*-\s*", " ", n)
    n = re.sub(r"\bgeist\b|\*+|university of|\bportal\b", " ", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # drop common location/suffix noise
    for w in (" inc", " llc", " co", " gdd", " mpmv", " ve", " so", " aetna"):
        if n.endswith(w):
            n = n[: -len(w)].strip()
    return n


def tight(name):
    return norm(name).replace(" ", "")


def build_index(existing):
    idx = {}
    tidx = {}
    pidx = {}
    for o in existing:
        idx.setdefault(norm(o["name"]), o)
        tidx.setdefault(tight(o["name"]), o)
        ph = digits(o.get("phone"))
        if len(ph) >= 10:
            pidx.setdefault(ph[-10:], o)
    return idx, tidx, pidx


def digits(v):
    return re.sub(r"\D", "", str(v or ""))


def match(name, index, phone=None):
    idx, tidx, pidx = index
    n = norm(name)
    if not n or len(n) < 3:
        ph = digits(phone)
        return pidx.get(ph[-10:]) if len(ph) >= 10 else None
    if n in idx:
        return idx[n]
    t = tight(name)
    if len(t) >= 5 and t in tidx:
        return tidx[t]
    # containment on the tight (spaceless) key
    if len(t) >= 6:
        for key, o in tidx.items():
            if len(key) >= 6 and (key.startswith(t) or t.startswith(key)):
                return o
    # token-prefix match: existing name sharing the leading word(s)
    head = n.split(" ")[0]
    if len(head) < 4:
        head = " ".join(n.split(" ")[:2])
    for key, o in idx.items():
        if not key:
            continue
        if key == n or key.startswith(n) or n.startswith(key):
            if min(len(key), len(n)) >= 4:
                return o
        kh = key.split(" ")[0]
        if len(head) >= 5 and kh == head:
            return o
    # last resort: same phone number
    ph = digits(phone)
    if len(ph) >= 10:
        return pidx.get(ph[-10:])
    return None


def emit_enrichment(out, existing):
    index = build_index(existing)
    seen_new = {}
    updates = 0
    inserts = 0
    for e in VENDOR_ENRICH:
        name = e["name"]
        o = match(name, index, e.get("phone"))
        cols = {
            "contact_name": e.get("contact_name"),
            "phone": e.get("phone"),
            "email": e.get("email"),
            "website": e.get("website"),
            "account_number": e.get("account_number"),
            "services": e.get("services"),
            "area": e.get("area"),
        }
        note = e.get("notes")
        if o:
            # fill NULL columns only (coalesce); append note
            sets = []
            for col, val in cols.items():
                if val:
                    sets.append(f"{col} = coalesce({col}, {q(val)})")
            if note:
                sets.append(
                    f"notes = case when notes is null or notes = '' then {q(note)} "
                    f"else notes || ' | ' || {q(note)} end"
                )
            if sets:
                out.append(
                    f"update greendogops.crm_organization set {', '.join(sets)} "
                    f"where id = '{o['id']}';"
                )
                updates += 1
            continue
        # no match -> only the structured sheets may create brand-new vendors
        if not e.get("allow_insert"):
            continue
        key = norm(name)
        if not key or len(key) < 3 or key in seen_new:
            continue
        seen_new[key] = True
        out.append(
            "insert into greendogops.crm_organization "
            "(org_type, name, contact_name, phone, email, website, "
            "account_number, services, area, notes, is_active, source) values ("
            f"{q(e['org_type'])}, {q(name)}, {q(e.get('contact_name'))}, "
            f"{q(e.get('phone'))}, {q(e.get('email'))}, {q(e.get('website'))}, "
            f"{q(e.get('account_number'))}, {q(e.get('services'))}, "
            f"{q(e.get('area'))}, {q(note)}, true, '{SOURCE}');"
        )
        inserts += 1
    return updates, inserts


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def emit_credentials(out):
    cols = ["category", "label", "service", "url", "username", "password",
            "account_number", "location", "contact_name", "contact_email",
            "contact_phone", "order_method", "payment_method", "status",
            "owner_scope", "notes"]
    for i, c in enumerate(CREDS):
        vals = ", ".join(q(c.get(k)) for k in cols)
        out.append(
            "insert into greendogops.credential ("
            + ", ".join(cols)
            + f", source, external_ref) values ({vals}, '{SOURCE}', "
            + f"'{SOURCE}:{i}');"
        )


def main():
    parse_historic()
    parse_managers_passwords()
    parse_retail()
    parse_handymen()
    parse_aetna_tech()
    parse_vendor_contacts()
    parse_vendor_updated()
    parse_facility()

    with open(EXISTING) as fh:
        existing = json.load(fh)[0]["json_agg"] or []

    out = ["set search_path = greendogops, public;", "begin;"]
    out.append(f"delete from greendogops.credential where source = '{SOURCE}';")
    emit_credentials(out)
    u, ins = emit_enrichment(out, existing)
    out.append("commit;")
    out.append(
        "select (select count(*) from greendogops.credential) as credentials, "
        "(select count(*) from greendogops.crm_organization "
        f"where source = '{SOURCE}') as new_vendors;"
    )
    sys.stderr.write(
        f"credentials={len(CREDS)} crm_updates={u} crm_inserts={ins}\n"
    )
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
