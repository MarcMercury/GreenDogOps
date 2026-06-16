import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RosterRow } from "@/lib/hr/types";
import { EmployeeForm } from "./employee-form";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, preferred_name, grid_name, full_name,
       email, phone_mobile, date_of_birth, postal_code, work_location_type,
       avatar_url, is_active, notes, status_changed_at, created_at, updated_at,
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
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load employee: {error.message}
        </p>
      </div>
    );
  }

  if (!data) notFound();

  const emp = (data as { person_employment?: unknown }).person_employment;
  const row: RosterRow = {
    ...data,
    person_employment: Array.isArray(emp) ? (emp[0] ?? null) : (emp ?? null),
  } as RosterRow;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/hr"
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to roster
      </Link>
      <EmployeeForm row={row} />
    </div>
  );
}
