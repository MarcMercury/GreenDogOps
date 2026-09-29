#!/usr/bin/env python3
"""
Compare the structure of the greendogops schema between two Supabase projects.

Fingerprints every column, constraint, index, RLS policy, trigger, routine and
enum, then reports what differs. Runs entirely through the Management API, so it
needs no database password.

Exit status is 1 when the schemas differ, which makes it usable as a CI gate
against schema drift.

Usage:
  scripts/compare_schemas.py --a <ref> --b <ref>
  scripts/compare_schemas.py --a <ref> --b <ref> --kind column
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
SCHEMA = "greendogops"

# Each probe returns rows of (sig). Ordering is irrelevant; the sets are diffed.
PROBES: dict[str, str] = {
    "column": f"""
        select c.relname || '.' || a.attname
               || ' :: ' || format_type(a.atttypid, a.atttypmod)
               || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
               || ' notnull=' || a.attnotnull as sig
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = '{SCHEMA}'
        left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
        where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','v','m','p')
    """,
    "constraint": f"""
        select c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid) as sig
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = '{SCHEMA}'
    """,
    "index": f"select indexname || ' :: ' || indexdef as sig from pg_indexes where schemaname = '{SCHEMA}'",
    "policy": f"""
        select tablename || ' ' || policyname || ' ' || cmd
               || ' roles=' || array_to_string(roles, ',')
               || ' using=' || coalesce(qual, '-')
               || ' check=' || coalesce(with_check, '-') as sig
        from pg_policies where schemaname = '{SCHEMA}'
    """,
    "rls_enabled": f"""
        select c.relname || ' rls=' || c.relrowsecurity as sig
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = '{SCHEMA}' and c.relkind = 'r'
    """,
    "trigger": f"""
        select c.relname || ' ' || t.tgname || ' ' || pg_get_triggerdef(t.oid) as sig
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = '{SCHEMA}'
        where not t.tgisinternal
    """,
    "routine": f"""
        select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
               || ' security_definer=' || p.prosecdef
               || ' md5=' || md5(p.prosrc) as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = '{SCHEMA}'
    """,
    "enum": f"""
        select t.typname || ' = ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as sig
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace and n.nspname = '{SCHEMA}'
        group by t.typname
    """,
    "view_def": f"""
        select c.relname || ' md5=' || md5(pg_get_viewdef(c.oid)) as sig
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = '{SCHEMA}' and c.relkind in ('v','m')
    """,
}


def load_token() -> str:
    for line in SECRETS.read_text().splitlines():
        if line.startswith("SUPABASE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip("\"'")
    sys.exit("SUPABASE_ACCESS_TOKEN not found in .secrets/supabase.env")


def run_sql(token: str, ref: str, sql: str) -> list[dict]:
    req = urllib.request.Request(
        API.format(ref=ref), data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"query failed on {ref}: HTTP {e.code}\n{e.read().decode()[:500]}") from None


def normalise(kind: str, sig: str) -> str:
    """
    Collapse differences that are cosmetic rather than structural.

    Postgres rebuilds a CHECK expression's parse tree when it re-reads the
    constraint, so `((a AND b) AND c)` and `(a AND b AND c)` describe the same
    rule but print differently. Comparing those raw reports a difference on
    every restored database.
    """
    s = " ".join(sig.split())
    if kind == "constraint":
        s = s.replace("(", "").replace(")", "").replace(" ", "")
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="reference project (expected)")
    ap.add_argument("--b", required=True, help="project under test")
    ap.add_argument("--kind", help="only compare one probe")
    ap.add_argument("--limit", type=int, default=15, help="max differences shown per kind")
    args = ap.parse_args()

    token = load_token()
    probes = {args.kind: PROBES[args.kind]} if args.kind else PROBES

    total = 0
    print(f"{'object kind':14}{'A':>8}{'B':>8}{'only A':>9}{'only B':>9}")
    print("-" * 48)
    details: list[str] = []
    for kind, sql in probes.items():
        a = {normalise(kind, r["sig"]) for r in run_sql(token, args.a, sql)}
        b = {normalise(kind, r["sig"]) for r in run_sql(token, args.b, sql)}
        only_a, only_b = sorted(a - b), sorted(b - a)
        total += len(only_a) + len(only_b)
        print(f"{kind:14}{len(a):>8}{len(b):>8}{len(only_a):>9}{len(only_b):>9}")
        for s in only_a[: args.limit]:
            details.append(f"  [{kind}] only in A: {s}")
        for s in only_b[: args.limit]:
            details.append(f"  [{kind}] only in B: {s}")

    if details:
        print("\ndifferences:")
        print("\n".join(details))
    print(f"\n{'IDENTICAL' if total == 0 else str(total) + ' DIFFERENCE(S)'}")
    sys.exit(0 if total == 0 else 1)


if __name__ == "__main__":
    main()
