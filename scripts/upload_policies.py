#!/usr/bin/env python3
"""Upload the newly-dropped policy PDFs from public/ into the private Supabase
`resources` bucket and emit SQL inserts for greendogops.resource_document.

Run:
  set -a; source .env.local; set +a
  python3 scripts/upload_policies.py > .data/_policies_insert.sql
  ./scripts/supabase-sql.sh -f .data/_policies_insert.sql

Idempotent: uploads use x-upsert; SQL guards each insert with NOT EXISTS on
storage_path so re-running does not duplicate rows. Files already present in the
resources library (urgent-care protocol, premises checklists) are intentionally
excluded here.
"""
import os
import re
import sys
import urllib.request

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")
BUCKET = "resources"

# filename -> (title, category, description, staff_only, sort_order)
META = {
    "Employee Pet Policy.pdf": (
        "Employee Pet Policy", "hr",
        "Policy covering employees bringing pets to the workplace.", False, 20),
    "GDD COMPENSATION OVERVIEW.pdf": (
        "Compensation Overview", "hr",
        "Overview of the company compensation structure.", False, 15),
    "GDD CORE ATTRIBUTES.pdf": (
        "Core Attributes", "hr",
        "The core attributes expected of Green Dog team members.", False, 12),
    "GDD Harassment Policy.pdf": (
        "Harassment Policy", "hr",
        "Company anti-harassment policy.", False, 30),
    "GDD PTO_Sick Time_Unpaid Time Off Policy.pdf": (
        "PTO / Sick Time / Unpaid Time Off Policy", "hr",
        "Paid time off, sick time, and unpaid time off policy.", False, 25),
    "GDD Pregnancy Safety.docx.pdf": (
        "Pregnancy Safety", "safety",
        "Workplace safety guidance for pregnant employees.", False, 20),
    "GDD Respectful Workplace Policy.docx.pdf": (
        "Respectful Workplace Policy", "hr",
        "Policy establishing standards for a respectful workplace.", False, 31),
    "GDD Review Process.pdf": (
        "Review Process", "hr",
        "Employee performance review process.", False, 18),
    "GDD Roles .pdf": (
        "Roles & Responsibilities", "hr",
        "Roles and responsibilities across the practice.", False, 11),
    "GDDVC - General Rescue Partners Agreement.pdf": (
        "Rescue Partners — General Agreement", "operations",
        "General agreement governing rescue-partner relationships.", False, 40),
    "GDDVC - Rescue Partners Protocols & Guidelines.pdf": (
        "Rescue Partners — Protocols & Guidelines", "operations",
        "Protocols and guidelines for working with rescue partners.", False, 41),
    "GDDVC Rescue Partners  - ALL RESCUE VETTING.pdf": (
        "Rescue Partners — Rescue Vetting", "operations",
        "Vetting process and requirements for rescue partners.", False, 42),
    "Gdd Continuing Education policy.pdf": (
        "Continuing Education Policy", "hr",
        "Continuing education policy and allowances.", False, 32),
    "Green Dog Attendance Policy.docx.pdf": (
        "Attendance Policy", "hr",
        "Attendance, call-out, and tardiness policy.", False, 33),
    "Green Dog Safety and Best Practice Handbook.docx.pdf": (
        "Safety & Best Practice Handbook", "safety",
        "Company safety manual and best-practice handbook.", False, 10),
    "Non-Employee Pet Discounts.pdf": (
        "Non-Employee Pet Discounts", "hr",
        "Pet-care discount policy for non-employees.", False, 34),
    "Safety Hazard Report Form.docx.pdf": (
        "Safety Hazard Report Form", "forms",
        "Form for reporting workplace safety hazards.", False, 20),
    "Workplace Relationships Policy.pdf": (
        "Workplace Relationships Policy", "hr",
        "Policy governing personal relationships between employees.", False, 35),
}


def slug(name: str) -> str:
    base = re.sub(r"\.pdf$", "", name, flags=re.I)
    base = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-").lower()
    return f"{base}.pdf"


def sqlstr(v) -> str:
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def upload(path: str, object_name: str) -> None:
    with open(path, "rb") as fh:
        data = fh.read()
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_name}"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {SERVICE_KEY}")
    req.add_header("Content-Type", "application/pdf")
    req.add_header("x-upsert", "true")
    with urllib.request.urlopen(req) as resp:
        if resp.status not in (200, 201):
            raise RuntimeError(f"upload failed {resp.status} for {object_name}")


def main() -> None:
    rows = []
    for fname, meta in META.items():
        src = os.path.join(PUBLIC_DIR, fname)
        if not os.path.exists(src):
            print(f"-- MISSING: {fname}", file=sys.stderr)
            continue
        title, category, desc, staff_only, sort_order = meta
        object_name = slug(fname)
        size = os.path.getsize(src)
        upload(src, object_name)
        print(f"-- uploaded {object_name} ({size} bytes)", file=sys.stderr)
        rows.append((title, category, desc, object_name, fname, size,
                     staff_only, sort_order))

    print("-- policy resource_document seed (idempotent on storage_path)")
    for (title, category, desc, object_name, fname, size,
         staff_only, sort_order) in rows:
        print(
            "insert into greendogops.resource_document "
            "(title, category, description, storage_path, file_name, "
            "mime_type, size_bytes, staff_only, sort_order) "
            f"select {sqlstr(title)}, {sqlstr(category)}, {sqlstr(desc)}, "
            f"{sqlstr(object_name)}, {sqlstr(fname)}, 'application/pdf', "
            f"{size}, {str(staff_only).lower()}, {sort_order} "
            "where not exists (select 1 from greendogops.resource_document "
            f"where storage_path = {sqlstr(object_name)});"
        )


if __name__ == "__main__":
    main()
