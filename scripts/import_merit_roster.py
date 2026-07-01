"""
Reconcile the Green Dog HR roster against the current employee data in
``public/Merit Increase Calculator.xlsx`` (sheet ``2026 EMP PROFILE DATA``).

The 2026 sheet is treated as the source of truth for current staff:
row 0 = category, row 1 = column header, rows 2+ = one employee per row.

For every employee row this emits a self-contained plpgsql DO block that:
  * finds the matching person id (active statuses only, matched on full name),
  * inserts a new person when none exists,
  * UPDATEs greendogops.person (coalesce -> only overwrite when the sheet has
    a value, never wipe an existing value with a blank cell),
  * UPSERTs greendogops.person_employment with the same coalesce semantics and
    merges the compliance JSON (existing || new) so tracked flags are preserved.

Usage:
    python3 scripts/import_merit_roster.py > /tmp/merit_roster.sql
    scripts/supabase-sql.sh -f /tmp/merit_roster.sql
"""
import datetime
import json
import openpyxl

PATH = "public/Merit Increase Calculator.xlsx"
SHEET = "2026 EMP PROFILE DATA"

# Rows whose Full Name is one of these are section separators, not people.
SECTION_MARKERS = {"others", "1099", "new", "inactive 1099"}


def sql_str(v):
    if v is None:
        return "null"
    s = str(v).strip()
    if s == "":
        return "null"
    return "'" + s.replace("'", "''") + "'"


def sql_num(v):
    if v is None or v == "":
        return "null"
    try:
        return repr(float(v))
    except (TypeError, ValueError):
        return "null"


def sql_zip(v):
    if v is None or v == "":
        return "null"
    if isinstance(v, float):
        return "'" + str(int(v)) + "'"
    return sql_str(v)


def sql_date(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return "'" + v.strftime("%Y-%m-%d") + "'"
    return "null"


def work_loc(v):
    if not v:
        return "null"
    s = str(v).strip().lower()
    if "remote" in s:
        return "'remote'"
    if "hybrid" in s:
        return "'hybrid'"
    if "house" in s:
        return "'in_house'"
    return "null"


def flsa(v):
    if not v:
        return "null"
    s = str(v).strip().lower()
    if "non" in s:
        return "'non_exempt'"
    if "exempt" in s:
        return "'exempt'"
    return "null"


def schedule(v):
    if not v:
        return "null"
    s = str(v).strip().lower()
    if "full" in s:
        return "'full_time'"
    if "part" in s:
        return "'part_time'"
    if "diem" in s:
        return "'per_diem'"
    if "contract" in s or "relief" in s:
        return "'contractor'"
    return "null"


def days_per_week(v):
    # Column occasionally holds a stray date/year; only accept a plausible count.
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        if 0 <= f <= 14:
            return repr(f)
    return "null"


def compliance_json(r):
    """Build a compliance JSON containing only the keys the sheet fills in, so
    the ``existing || new`` merge never overwrites a tracked flag with null."""
    fields = {
        "offer_letter_completed": r[26],
        "handbook_signed": r[27],
        "onboarding_completed": r[28],
        "benefits_completed": r[29],
        "sexual_harassment_training_date": r[30],
        "harassment_pay": r[31],
        "background_check_processed": r[32],
        "safety_training": r[33],
        "emergency_contact_form": r[34],
        "contract_sent": r[35],
        "contract_signed": r[36],
        "approved_denied": r[37],
        "ce_contract_sent": r[38],
        "ce_contract_signed": r[39],
        "immigration_agreement_sent": r[40],
        "immigration_agreement_signed": r[41],
        "licenses_tracked": r[42],
    }
    out = {}
    for k, v in fields.items():
        if v is None:
            continue
        if isinstance(v, (datetime.datetime, datetime.date)):
            out[k] = v.strftime("%Y-%m-%d")
        else:
            s = str(v).strip()
            if s != "":
                out[k] = s
    return out


def main():
    wb = openpyxl.load_workbook(PATH, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))

    print("begin;")
    current_status = "employee"  # rows before the "1099" marker are employees

    for r in rows[2:]:
        # Pad short rows so index access is safe.
        r = list(r) + [None] * (43 - len(r))
        name_raw = r[0]
        if name_raw is None:
            continue
        name = str(name_raw).strip()
        if name == "":
            continue

        low = name.lower()
        # Section markers set the status context for subsequent new inserts.
        if low in SECTION_MARKERS or low.replace(".0", "") == "1099":
            if low.startswith("1099") or low == "1099":
                current_status = "contractor"
            elif low == "inactive 1099":
                current_status = "contractor"
            elif low == "others":
                current_status = "employee"
            continue

        comp = json.dumps(compliance_json(r))
        vals = {
            "full_name": sql_str(r[0]),
            "grid_name": sql_str(r[1]),
            "first_name": sql_str(r[2]),
            "last_name": sql_str(r[3]),
            "date_of_birth": sql_date(r[4]),
            "postal_code": sql_zip(r[5]),
            "work_location_type": work_loc(r[6]),
            "offer_title": sql_str(r[7]),
            "adp_job_title": sql_str(r[8]),
            "hire_date": sql_date(r[9]),
            "flsa_status": flsa(r[10]),
            "work_schedule": schedule(r[11]),
            "days_per_week": days_per_week(r[12]),
            "latest_wage_change_date": sql_date(r[13]),
            "current_rate": sql_num(r[14]),
            "previous_rate": sql_num(r[15]),
            "biweekly_wage": sql_num(r[16]),
            "annual_wages": sql_num(r[17]),
            "pto_allotment": sql_str(r[18]),
            "pto_policy_allotment": sql_num(r[19]),
            "pto_used": sql_num(r[20]),
            "pto_available": sql_num(r[21]),
            "pto_notes": sql_str(r[22]),
            "ce_budget": sql_num(r[23]),
            "ce_used": sql_num(r[24]),
            "ce_remaining": sql_num(r[25]),
        }

        print("do $$")
        print("declare pid uuid;")
        print("begin")
        print(
            "  select id into pid from greendogops.person "
            f"where trim(full_name) = trim({vals['full_name']}) "
            "and status in ('employee','contractor','prospect','applicant') "
            "order by (status = 'employee') desc, (status = 'contractor') desc limit 1;"
        )
        print("  if pid is null then")
        print(
            "    insert into greendogops.person (status, full_name, first_name, last_name, is_active) "
            f"values ('{current_status}', {vals['full_name']}, {vals['first_name']}, {vals['last_name']}, true) "
            "returning id into pid;"
        )
        print("  end if;")

        # Person: overwrite only when the sheet provides a value.
        print("  update greendogops.person set")
        person_sets = [
            f"    grid_name = coalesce({vals['grid_name']}, grid_name)",
            f"    first_name = coalesce({vals['first_name']}, first_name)",
            f"    last_name = coalesce({vals['last_name']}, last_name)",
            f"    date_of_birth = coalesce({vals['date_of_birth']}, date_of_birth)",
            f"    postal_code = coalesce({vals['postal_code']}, postal_code)",
            f"    work_location_type = coalesce({vals['work_location_type']}, work_location_type)",
        ]
        print(",\n".join(person_sets))
        print("  where id = pid;")

        # Employment: upsert with coalesce + compliance merge.
        emp_cols = [
            "offer_title", "adp_job_title", "flsa_status", "work_schedule",
            "days_per_week", "hire_date", "latest_wage_change_date",
            "current_rate", "previous_rate", "biweekly_wage", "annual_wages",
            "pto_allotment", "pto_policy_allotment", "pto_used", "pto_available",
            "pto_notes", "ce_budget", "ce_used", "ce_remaining",
        ]
        col_list = ", ".join(["person_id"] + emp_cols + ["compliance"])
        val_list = ", ".join(["pid"] + [vals[c] for c in emp_cols] + [f"'{comp}'::jsonb"])
        print(f"  insert into greendogops.person_employment ({col_list})")
        print(f"  values ({val_list})")
        print("  on conflict (person_id) do update set")
        set_lines = [
            f"    {c} = coalesce(excluded.{c}, greendogops.person_employment.{c})"
            for c in emp_cols
        ]
        set_lines.append(
            "    compliance = greendogops.person_employment.compliance || excluded.compliance"
        )
        print(",\n".join(set_lines) + ";")
        print("end $$;")

    print("commit;")
    wb.close()


if __name__ == "__main__":
    main()
