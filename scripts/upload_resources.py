#!/usr/bin/env python3
"""Upload the resource-library PDFs from public/ into the private Supabase
`resources` bucket and emit SQL inserts for greendogops.resource_document.

Run:
  set -a; source .env.local; set +a
  python3 scripts/upload_resources.py > .data/_resources_insert.sql
  ./scripts/supabase-sql.sh -f .data/_resources_insert.sql

Idempotent: uploads use x-upsert; SQL guards each insert with NOT EXISTS on
storage_path so re-running does not duplicate rows.
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
    "3rd Party Event Details.pdf": (
        "3rd Party Event Details", "marketing",
        "Guidelines for participating in third-party community events.", False, 10),
    "GDD FAQs - STAFF ONLY.pdf": (
        "GDD FAQs (Staff Only)", "hr",
        "Internal staff frequently-asked-questions reference.", True, 10),
    "GDD Release of Liability and Settlement.pdf": (
        "Release of Liability and Settlement", "forms",
        "Release of liability and settlement form.", False, 10),
    "GDD Santa Monica Parking.pdf": (
        "Santa Monica Parking", "operations",
        "Parking information for the Santa Monica location.", False, 20),
    "GDD Surgeon Recruiting .pdf": (
        "Surgeon Recruiting", "recruiting",
        "Surgeon recruiting overview and talking points.", False, 10),
    "Green Dog Dental & Veterinary Center & DogPPL Partnership_ Monthly Vaccine Clinics.pdf": (
        "DogPPL Partnership — Monthly Vaccine Clinics", "marketing",
        "Details of the DogPPL partnership and monthly vaccine clinics.", False, 20),
    "Green Dog Dental – MASTER INSPECTION & COMPLIANCE CHECKLIST.pdf": (
        "Master Inspection & Compliance Checklist", "medical",
        "Master inspection and compliance checklist for the practice.", False, 10),
    "Green Dog HR Guide.pdf": (
        "Green Dog HR Guide", "hr",
        "Company HR guide covering policies and procedures.", False, 5),
    "Green Dog SLACK Workflows.pdf": (
        "Slack Workflows", "operations",
        "Slack channels, workflows, and communication conventions.", False, 30),
    "Green Dog Scheduling Protocol.pdf": (
        "Scheduling Protocol", "operations",
        "How shifts and the company schedule are built and managed.", False, 10),
    "Scritch Training Guide_ Green Dog Dental & Veterinary Center.pdf": (
        "Scritch Training Guide", "training",
        "Training guide for the Scritch software platform.", False, 10),
    "GDD Urgent Care Locations and Injury Protocol.pdf": (
        "Urgent Care Locations and Injury Protocol", "safety",
        "Nearest urgent-care locations and the on-the-job injury protocol.", False, 10),
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

    print("-- resource_document seed (idempotent on storage_path)")
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
