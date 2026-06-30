import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { RosterRow } from "@/lib/hr/types";
import { redactCompensation } from "@/lib/hr/types";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewAllCompensation, canEditModule } from "@/lib/auth/permissions";
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

  const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("person")
      .select(
        `id, status, first_name, last_name, preferred_name, grid_name, full_name,
       email, phone_mobile, phone_home, phone_other, date_of_birth, postal_code, work_location_type,
     opportunity_type, avatar_url, is_active, notes, source_contact_id, status_changed_at, created_at, updated_at,
       person_employment (
         person_id, position_id, location_id, offer_title, adp_job_title,
         flsa_status, work_schedule, days_per_week, hire_date, original_hire_date,
         pay_type, current_rate, previous_rate, latest_wage_change_date,
         biweekly_wage, annual_wages, pto_allotment, pto_policy_allotment,
         pto_used, pto_available, pto_notes, ce_budget, ce_used, ce_remaining,
         benefits_enrolled, benefits_monthly, benefits_annual, last_review_date,
         compliance, separation_date, separation_type, separation_letter_signed,
         separation_notes
       )`,
      )
      .order("last_name", { ascending: true })
      .range(from, to),
  );

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

  // Supabase returns the 1:1 relation as an array; normalize to a single object.
  const rows: RosterRow[] = (data ?? []).map((r) => {
    const emp = (r as { person_employment?: unknown }).person_employment;
    const row = {
      ...r,
      person_employment: Array.isArray(emp) ? (emp[0] ?? null) : (emp ?? null),
    } as RosterRow;
    return viewAllComp || row.id === ownPersonId
      ? row
      : redactCompensation(row);
  });

  return <RosterGrid rows={rows} canEdit={canEdit} />;
}
