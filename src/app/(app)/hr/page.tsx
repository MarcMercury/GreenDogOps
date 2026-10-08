import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { RosterRow } from "@/lib/hr/types";
import { redactPrivate } from "@/lib/hr/types";
import {
  loadCompensation,
  withCompensation,
} from "@/lib/hr/compensation";
import { getCurrentUser } from "@/lib/auth/session";
import {
  canViewAllCompensation,
  canEditModule,
  seesPrivateHrFields,
} from "@/lib/auth/permissions";
import { RosterGrid } from "./roster-grid";

export const dynamic = "force-dynamic";

export default async function HrRosterPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const viewAllComp = current
    ? canViewAllCompensation(current.appUser.role)
    : false;
  const canEdit = current ? canEditModule(current.appUser, "hr") : false;
  const ownPersonId = current?.appUser.person_id ?? null;

  // Compensation columns are not readable by the API role (migration 0227);
  // they are loaded below with the service role for the people this viewer may
  // see — everyone for comp roles, otherwise just their own record.
  const [{ data, error }, comp] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("person")
        .select(
          `id, status, first_name, last_name, grid_name, full_name,
       email, phone_mobile, phone_home, phone_other, date_of_birth, postal_code, work_location_type,
     opportunity_type, avatar_url, is_active, notes, source_contact_id, status_changed_at, created_at, updated_at,
       person_employment (
         person_id, position_id, location_id, preferred_location_id, offer_title, adp_job_title,
         flsa_status, work_schedule, schedule_type, days_per_week, hire_date, original_hire_date,
         pto_allotment, pto_policy_allotment, pto_used, pto_available, pto_notes,
         compliance, separation_date, separation_type, separation_letter_signed,
         separation_notes
       ),
       sched_employee_setting ( is_schedulable )`,
        )
        .order("last_name", { ascending: true })
        .range(from, to),
    ),
    viewAllComp
      ? loadCompensation("all")
      : loadCompensation(ownPersonId ? [ownPersonId] : []),
  ]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">HR / Roster</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load roster: {error.message}
        </p>
      </div>
    );
  }

  // Supabase returns the 1:1 relations as arrays; normalize to single objects.
  const rows: RosterRow[] = (data ?? []).map((r) => {
    const emp = (r as { person_employment?: unknown }).person_employment;
    const sched = (r as { sched_employee_setting?: unknown })
      .sched_employee_setting;
    const row = {
      ...r,
      person_employment: Array.isArray(emp) ? (emp[0] ?? null) : (emp ?? null),
      sched_employee_setting: Array.isArray(sched)
        ? (sched[0] ?? null)
        : (sched ?? null),
    } as RosterRow;
    const withComp = withCompensation(row, comp.get(row.id));
    return current && !seesPrivateHrFields(current.appUser, row.id)
      ? redactPrivate(withComp)
      : withComp;
  });

  return (
    <RosterGrid rows={rows} canEdit={canEdit} canViewAllComp={viewAllComp} />
  );
}
