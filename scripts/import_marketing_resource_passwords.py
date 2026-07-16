#!/usr/bin/env python3
"""One-off: populate greendogops.marketing_resource username/password from the
'RESOURCES & PW' sheet of public/Marketing Spreadsheets (2).xlsx.

Matches sheet rows to existing resource records by normalized name, then by
URL host. Emits UPDATE statements (to stdout) and a match report (to stderr).
"""
import json
import re
import sys

import openpyxl

XLSX = "public/Marketing Spreadsheets (2).xlsx"
RES_JSON = "/tmp/resources.json"


def norm_name(s):
    if not s:
        return ""
    s = str(s).lower()
    s = s.replace("\xa0", " ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def host(u):
    if not u:
        return ""
    u = str(u).strip().lower().replace("\xa0", "")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.split("/")[0].strip()


def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("\xa0", " ").strip().replace("'", "''") + "'"


# --- load resources ---------------------------------------------------------
resources = json.load(open(RES_JSON))[0]["json_agg"]
by_name = {}
by_host = {}
for r in resources:
    by_name.setdefault(norm_name(r["name"]), []).append(r)
    h = host(r["url"])
    if h:
        by_host.setdefault(h, []).append(r)

# --- read sheet -------------------------------------------------------------
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb["RESOURCES & PW"]
rows = list(ws.iter_rows(values_only=True))

updates = {}      # resource id -> (username, password, source_name)
matched, unmatched = [], []

for r in rows[1:]:
    r = list(r) + [None] * (8 - len(r))
    name, url, username, email, password = r[0], r[1], r[2], r[3], r[4]
    name = (str(name).replace("\xa0", " ").strip() if name else "")
    if not name:
        continue
    # skip password-vault doc pointers (google sheets of other passwords)
    low = (name + " " + str(url or "")).lower()
    if password is None and username is None and email is None:
        continue
    if "docs.google.com" in low and password is None:
        continue

    user = (username or email)
    user = str(user).strip() if user else None
    pw = str(password).strip() if password else None
    if not user and not pw:
        continue

    # match: exact normalized name, else host
    cand = by_name.get(norm_name(name))
    if not cand:
        h = host(url)
        cand = by_host.get(h) if h else None
    if not cand:
        unmatched.append((name, user, bool(pw)))
        continue

    for res in cand:
        # don't overwrite a better (name) match with a weaker one
        prev = updates.get(res["id"])
        if prev and prev[3] == "name":
            continue
        kind = "name" if norm_name(name) == norm_name(res["name"]) else "host"
        updates[res["id"]] = (user, pw, name, kind)
        matched.append((name, res["name"], kind))

# --- emit SQL ---------------------------------------------------------------
print("set search_path = greendogops, public;")
for rid, (user, pw, src, kind) in updates.items():
    print(
        f"update greendogops.marketing_resource set "
        f"username = {q(user)}, password = {q(pw)} where id = '{rid}';"
    )

# --- report -----------------------------------------------------------------
sys.stderr.write(f"\nMATCHED {len(updates)} resources:\n")
for src, dst, kind in sorted(matched, key=lambda x: x[1]):
    sys.stderr.write(f"  [{kind}] {dst}  <=  {src}\n")
sys.stderr.write(f"\nUNMATCHED sheet rows ({len(unmatched)}):\n")
for name, user, has_pw in unmatched:
    sys.stderr.write(f"  {name}  (user={user}, pw={has_pw})\n")
