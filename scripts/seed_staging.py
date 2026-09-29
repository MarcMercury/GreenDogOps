#!/usr/bin/env python3
"""
Fill a NON-PRODUCTION Supabase project with synthetic scheduling data.

Creates fake employees, role eligibility, several weeks of grid, attendance
history, and time-off requests, so the Schedule and Attendance screens can be
evaluated without touching anyone's real record.

Every generated person gets an @staging.invalid email address (.invalid is a
reserved TLD that can never resolve), which is both the marker used to wipe a
previous seed and an unmistakable signal that a row is not a real employee.

Attendance is not purely random: four "story" employees are scripted to land on
specific grace-point totals so the reliability thresholds can be exercised.

Usage:
  scripts/seed_staging.py --to <target_ref>
  scripts/seed_staging.py --to <target_ref> --wipe-only
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import random
import sys
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".secrets" / "supabase.env"
API = "https://api.supabase.com/v1/projects/{ref}/database/query"
MARKER = "@staging.invalid"

# Fixed seed so a re-run reproduces the same people and the same history.
RNG = random.Random(20260929)

FIRST = [
    "Marisol", "Dashiell", "Priya", "Bartholomew", "Ingrid", "Thaddeus", "Anouk",
    "Lorenzo", "Beatrix", "Kwame", "Saoirse", "Ignatius", "Fumiko", "Rafferty",
    "Clementine", "Oleander", "Xiomara", "Percival", "Harriet", "Cyrus",
    "Delphine", "Augustin", "Rosalind", "Emeka", "Winifred", "Caspian",
    "Theodora", "Lucian", "Magnolia", "Soren", "Isolde", "Barnaby",
]
LAST = [
    "Quillfeather", "Vandermeer", "Ashgrove", "Blackwood", "Thistlewaite",
    "Marchetti", "Ravensdale", "Holloway", "Pemberton", "Casterbridge",
    "Fairweather", "Underhill", "Nightingale", "Brambleton", "Waverly",
    "Stonebridge", "Ellingham", "Fitzwilliam", "Hargreaves", "Mortimer",
    "Sandoval", "Whitlock", "Beaumont", "Calloway", "Draycott", "Everhart",
    "Fennimore", "Godfrey", "Harrowgate", "Inglewood", "Jessup", "Kingsley",
]

# Attendance mix for ordinary employees. Weighted to look like a real clinic:
# mostly present, occasional lateness, rare absence.
ORDINARY = (
    ["present"] * 86 + ["late"] * 4 + ["late_excused"] * 2
    + ["absent"] * 2 + ["absent_excused"] * 2 + ["no_show"] * 1 + ["pto"] * 3
)

# Scripted totals so the 12- and 18-point policy gates are both represented.
# (tardy = 0.5, absence = 4, no_show = 4, excused/pto = 0)
STORIES = {
    0: [],                                              # spotless
    1: ["late"] * 6 + ["absent"] * 2,                   # 11 pts, just under 12
    2: ["late"] * 4 + ["absent"] * 3,                   # 14 pts, warning issued
    3: ["absent"] * 4 + ["no_show"] * 1 + ["late"] * 4,  # 22 pts, disciplinary
}


def load_secrets() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("\"'")
    return out


def run_sql(token: str, ref: str, sql: str):
    req = urllib.request.Request(
        API.format(ref=ref), data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"SQL failed on {ref}: HTTP {e.code}\n{e.read().decode()[:700]}") from None


def q(v) -> str:
    """Render a Python value as a SQL literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def rows_sql(table: str, cols: list[str], rows: list[tuple]) -> str:
    if not rows:
        return ""
    body = ",\n".join("(" + ",".join(q(c) for c in r) + ")" for r in rows)
    return f"insert into greendogops.{table} ({', '.join(cols)}) values\n{body};"


def sunday_of(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=(d.weekday() + 1) % 7)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--wipe-only", action="store_true")
    args = ap.parse_args()

    sec = load_secrets()
    token, prod = sec["SUPABASE_ACCESS_TOKEN"], sec["SUPABASE_PROJECT_REF"]
    if args.to == prod:
        sys.exit("REFUSING: that is the production project.")
    sql = lambda s: run_sql(token, args.to, s)

    # --- wipe any previous seed -------------------------------------------
    sql(f"""
        delete from greendogops.sched_assignment where person_id in
          (select id from greendogops.person where email like '%{MARKER}');
        delete from greendogops.person_time_off where person_id in
          (select id from greendogops.person where email like '%{MARKER}');
        delete from greendogops.sched_role_member where person_id in
          (select id from greendogops.person where email like '%{MARKER}');
        delete from greendogops.person_employment where person_id in
          (select id from greendogops.person where email like '%{MARKER}');
        delete from greendogops.person where email like '%{MARKER}';
        delete from greendogops.sched_assignment where week_id in
          (select id from greendogops.sched_week where title like 'SEED %');
        delete from greendogops.sched_closure where week_id in
          (select id from greendogops.sched_week where title like 'SEED %');
        delete from greendogops.sched_week_location where week_id in
          (select id from greendogops.sched_week where title like 'SEED %');
        delete from greendogops.sched_week_line where week_id in
          (select id from greendogops.sched_week where title like 'SEED %');
        delete from greendogops.sched_week where title like 'SEED %';
    """)
    print("wiped previous seed")
    if args.wipe_only:
        return

    # --- read the config we must attach to --------------------------------
    locations = sql("select id, short_code, name from greendogops.location where is_active order by sort_order;")
    templates = sql("""select t.id, t.department_id, t.role_id, t.label, t.start_time, t.end_time,
                              coalesce(t.sort_order,0) sort_order
                       from greendogops.sched_shift_template t
                       join greendogops.sched_department d on d.id=t.department_id
                       where t.is_active and d.is_active order by t.sort_order;""")
    roles = sql("select id, department_id, name from greendogops.sched_role;")
    if not locations or not templates:
        sys.exit("Target has no locations or shift templates; copy reference data first.")
    print(f"config: {len(locations)} locations, {len(templates)} shift templates, {len(roles)} roles")

    # --- people ------------------------------------------------------------
    people, employment, members = [], [], []
    names = [(f, l) for f in FIRST for l in LAST]
    RNG.shuffle(names)
    roster: list[dict] = []
    for i in range(32):
        first, last = names[i]
        pid = str(uuid.uuid4())
        loc = RNG.choice(locations)
        remote = RNG.random() < 0.25
        roster.append({"id": pid, "name": f"{first} {last}", "loc": loc["id"]})
        people.append((
            pid, "employee", first, last, f"{first} {last[0]}.", f"{first} {last}",
            f"{first.lower()}.{last.lower()}{MARKER}",
            "remote" if remote else "in_house", True,
        ))
        employment.append((
            pid, loc["id"], loc["id"],
            "full_time" if RNG.random() < 0.8 else "part_time",
            (dt.date.today() - dt.timedelta(days=RNG.randint(90, 2200))).isoformat(),
            float(RNG.randint(40, 120)),
        ))
        for role in RNG.sample(roles, k=RNG.choice([2, 3, 3, 4])):
            members.append((str(uuid.uuid4()), role["id"], pid))

    # Every role needs a few eligible people or its shift lines stay empty and
    # the grid renders mostly blank.
    by_role: dict[str, set[str]] = {}
    for m in members:
        by_role.setdefault(m[1], set()).add(m[2])
    for role in roles:
        have = by_role.setdefault(role["id"], set())
        while len(have) < 3:
            pid = RNG.choice(roster)["id"]
            if pid not in have:
                have.add(pid)
                members.append((str(uuid.uuid4()), role["id"], pid))

    sql(rows_sql("person",
        ["id", "status", "first_name", "last_name", "grid_name", "full_name",
         "email", "work_location_type", "is_active"], people))
    sql(rows_sql("person_employment",
        ["person_id", "location_id", "preferred_location_id", "work_schedule",
         "hire_date", "pto_policy_allotment"], employment))
    sql(rows_sql("sched_role_member", ["id", "role_id", "person_id"], members))
    print(f"people: {len(people)}  eligibility rows: {len(members)}")

    # --- weeks: 5 past (published), 1 current (published), 2 future --------
    today = dt.date.today()
    this_sunday = sunday_of(today)
    weeks = []
    for offset in range(-5, 3):
        ws = this_sunday + dt.timedelta(weeks=offset)
        weeks.append({
            "id": str(uuid.uuid4()), "start": ws,
            "status": "published" if offset <= 0 else ("pending_approval" if offset == 1 else "draft"),
        })

    sql(rows_sql("sched_week", ["id", "week_start", "title", "status", "is_template"],
        [(w["id"], w["start"].isoformat(), f"SEED {w['start']}", w["status"], False) for w in weeks]))

    # Lines, locations and closures for every week.
    lines, weeklocs, closures = [], [], []
    line_index: dict[str, list[dict]] = {}
    for w in weeks:
        line_index[w["id"]] = []
        for t in templates:
            lid = str(uuid.uuid4())
            lines.append((lid, w["id"], t["id"], t["department_id"], t["role_id"],
                          t["label"], t["start_time"], t["end_time"], t["sort_order"]))
            line_index[w["id"]].append({"id": lid, "role_id": t["role_id"]})
        for i, loc in enumerate(locations):
            weeklocs.append((str(uuid.uuid4()), w["id"], loc["id"], i * 10))
            days = [0] + ([2, 3] if (loc["short_code"] or "").upper() == "SO" else [])
            for d in days:
                closures.append((str(uuid.uuid4()), w["id"], loc["id"], d))

    sql(rows_sql("sched_week_line",
        ["id", "week_id", "template_id", "department_id", "role_id", "label",
         "start_time", "end_time", "sort_order"], lines))
    sql(rows_sql("sched_week_location", ["id", "week_id", "location_id", "sort_order"], weeklocs))
    sql(rows_sql("sched_closure", ["id", "week_id", "location_id", "day_of_week"], closures))
    print(f"weeks: {len(weeks)}  lines: {len(lines)}  closures: {len(closures)}")

    # --- assignments + attendance -----------------------------------------
    eligible: dict[str, list[str]] = {}
    for m in members:
        eligible.setdefault(m[1], []).append(m[2])

    # Pre-build each story employee's queue of scripted outcomes.
    story_queue = {roster[i]["id"]: list(v) for i, v in STORIES.items()}
    for v in story_queue.values():
        RNG.shuffle(v)

    assignments = []
    closed = {(c[1], c[2], c[3]) for c in closures}
    for w in weeks:
        for ln in line_index[w["id"]]:
            pool = eligible.get(ln["role_id"] or "", [])
            if not pool:
                continue
            for day in range(7):
                work_date = w["start"] + dt.timedelta(days=day)
                loc = RNG.choice(locations)
                if (w["id"], loc["id"], day) in closed:
                    continue
                if RNG.random() > 0.70:          # not every line is staffed daily
                    continue
                person = RNG.choice(pool)

                status = "scheduled"
                if work_date < today:
                    queue = story_queue.get(person)
                    if queue:
                        status = queue.pop()
                    else:
                        status = RNG.choice(ORDINARY)
                assignments.append((
                    str(uuid.uuid4()), w["id"], ln["id"], loc["id"], person, day,
                    work_date.isoformat(), status,
                ))

    for i in range(0, len(assignments), 400):
        sql(rows_sql("sched_assignment",
            ["id", "week_id", "line_id", "location_id", "person_id",
             "day_of_week", "work_date", "attendance_status"], assignments[i:i + 400]))
    print(f"assignments: {len(assignments)}")

    # --- time off ----------------------------------------------------------
    timeoff = []
    for p in RNG.sample(roster, 10):
        start = this_sunday + dt.timedelta(days=RNG.randint(-14, 20))
        timeoff.append((
            str(uuid.uuid4()), p["id"], RNG.choice(["pto", "vacation", "time_off"]),
            RNG.choice(["requested", "requested", "approved"]),
            start.isoformat(), (start + dt.timedelta(days=RNG.choice([0, 0, 1, 2]))).isoformat(),
            "Seeded sample request",
        ))
    sql(rows_sql("person_time_off",
        ["id", "person_id", "kind", "status", "start_date", "end_date", "note"], timeoff))
    print(f"time-off requests: {len(timeoff)}")

    counts = sql("""select
        (select count(*) from greendogops.person) people,
        (select count(*) from greendogops.sched_week where not is_template) weeks,
        (select count(*) from greendogops.sched_assignment) assignments,
        (select count(*) from greendogops.person_time_off) time_off;""")[0]
    print("\nstaging now holds:", counts)


if __name__ == "__main__":
    main()
