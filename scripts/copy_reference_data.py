#!/usr/bin/env python3
"""
Copy whole tables from the production Supabase project into another project.

Intended for REFERENCE / CONFIGURATION data only (locations, departments, roles,
shift templates, appointment-type maps...). It is deliberately not suitable for
bulk people data: everything is pulled through the Management API as JSON.

Rows are inserted with jsonb_populate_recordset so column order and types are
resolved by the target's own definition, and `on conflict do nothing` makes
re-runs idempotent.

Usage:
  scripts/copy_reference_data.py --to <target_ref> location sched_department
  scripts/copy_reference_data.py --to <target_ref> --truncate location sched_role
  scripts/copy_reference_data.py --to <target_ref> --schema greendogops location

--truncate empties the listed tables (CASCADE) before copying, so the target
ends up an exact mirror of production rather than a merge. Migrations often seed
these same tables with freshly generated UUIDs, and a plain copy then leaves two
generations of rows behind.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".secrets" / "supabase.env"
API = "https://api.supabase.com/v1/projects/{ref}/database/query"
# Management API rejects very large bodies; insert in chunks.
CHUNK = 500


def load_secrets() -> dict[str, str]:
    if not SECRETS.exists():
        sys.exit(f"ERROR: {SECRETS} not found.")
    out: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("\"'")
    return out


def run_sql(token: str, ref: str, sql: str):
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        API.format(ref=ref),
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:800]
        raise SystemExit(f"ERROR on {ref}: HTTP {e.code}\n{detail}") from None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True, help="target project ref")
    ap.add_argument("--schema", default="greendogops")
    ap.add_argument("--truncate", action="store_true",
                    help="empty the tables (CASCADE) before copying")
    ap.add_argument("--null-cols", default="",
                    help="comma-separated columns to blank out on copy, for FKs "
                         "pointing at transactional tables the target has none of")
    ap.add_argument("tables", nargs="+")
    args = ap.parse_args()

    sec = load_secrets()
    token = sec["SUPABASE_ACCESS_TOKEN"]
    source = sec["SUPABASE_PROJECT_REF"]

    if args.to == source:
        sys.exit("REFUSING: target is the production project.")

    if args.truncate:
        targets = ", ".join(f"{args.schema}.{t}" for t in args.tables)
        run_sql(token, args.to, f"truncate {targets} cascade;")
        print(f"truncated (cascade): {targets}")

    null_cols = [c.strip() for c in args.null_cols.split(",") if c.strip()]

    for table in args.tables:
        qualified = f"{args.schema}.{table}"
        rows = run_sql(
            token, source,
            f"select coalesce(json_agg(t), '[]'::json) as rows from {qualified} t;",
        )[0]["rows"]

        if not rows:
            print(f"{table:38} 0 rows in source, skipped")
            continue

        for col in null_cols:
            for r in rows:
                if col in r:
                    r[col] = None

        for i in range(0, len(rows), CHUNK):
            payload = json.dumps(rows[i:i + CHUNK]).replace("'", "''")
            run_sql(
                token, args.to,
                f"insert into {qualified} "
                f"select * from jsonb_populate_recordset(null::{qualified}, '{payload}'::jsonb) "
                f"on conflict do nothing;",
            )

        count = run_sql(token, args.to, f"select count(*) as n from {qualified};")[0]["n"]
        print(f"{table:38} {len(rows):>6} copied -> {count} now in target")


if __name__ == "__main__":
    main()
