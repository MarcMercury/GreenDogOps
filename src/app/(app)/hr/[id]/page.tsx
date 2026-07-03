import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  RosterRow,
  PersonReview,
  PersonAsset,
  PersonPtoDay,
  PersonTimeOff,
  PersonDocument,
  PersonDocumentWithUrl,
  PersonRecruitingSummary,
  PersonOnboardingItem,
  PersonComplianceEntry,
  PersonLicense,
} from "@/lib/hr/types";
import { redactCompensation } from "@/lib/hr/types";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewAllCompensation, canEditModule } from "@/lib/auth/permissions";
import {
  getPersonAttendance,
  getPersonScheduleSettings,
  getPersonEligibility,
} from "../../schedule/data";
import { EmployeeProfile, type LinkedAccount } from "./employee-profile";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  // Compensation is visible to Owner/Admin/Manager-HR for everyone, and to any
  // user for their own linked record. Editing follows the HR module rule.
  const canViewComp = current
    ? canViewAllCompensation(current.appUser.role) ||
      current.appUser.person_id === id
    : false;
  const canEdit = current ? canEditModule(current.appUser, "hr") : false;
  const canEditSchedule = current
    ? canEditModule(current.appUser, "schedule")
    : false;

  const { data, error } = await supabase
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
       ),
       person_recruiting (
         person_id, pipeline, stage, status_notes, source, interview_date,
         score, resume_url, keep_for_future, follow_up_date, notes,
         created_at, updated_at
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
  const rec = (data as { person_recruiting?: unknown }).person_recruiting;
  const rawRow: RosterRow = {
    ...data,
    person_employment: Array.isArray(emp) ? (emp[0] ?? null) : (emp ?? null),
  } as RosterRow;
  const row = canViewComp ? rawRow : redactCompensation(rawRow);

  const recruitingRaw = Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null);
  const recruiting = recruitingRaw as PersonRecruitingSummary | null;

  // Sub-records for the Reviews / Assets / Documents / Attendance / Onboarding tabs.
  const [
    reviewsRes,
    assetsRes,
    docsRes,
    ptoRes,
    timeOffRes,
    onboardingRes,
    complianceRes,
    licensesRes,
  ] = await Promise.all([
    supabase
      .from("person_review")
      .select("*")
      .eq("person_id", id)
      .order("review_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("person_asset")
      .select("*")
      .eq("person_id", id)
      .order("assigned_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("person_document")
      .select("*")
      .eq("person_id", id)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("person_pto_day")
      .select("*")
      .eq("person_id", id)
      .order("pto_date", { ascending: false }),
    supabase
      .from("person_time_off")
      .select("*")
      .eq("person_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("person_onboarding_item")
      .select("*")
      .eq("person_id", id),
    supabase
      .from("person_compliance_entry")
      .select("*")
      .eq("person_id", id)
      .order("completed_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("person_license")
      .select("*")
      .eq("person_id", id)
      .order("expiration_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  const reviews = (reviewsRes.data ?? []) as PersonReview[];
  const assets = (assetsRes.data ?? []) as PersonAsset[];
  const documents = (docsRes.data ?? []) as PersonDocument[];
  const ptoDays = (ptoRes.data ?? []) as PersonPtoDay[];
  const timeOff = (timeOffRes.data ?? []) as PersonTimeOff[];
  const onboarding = (onboardingRes.data ?? []) as PersonOnboardingItem[];
  const compliance = (complianceRes.data ?? []) as PersonComplianceEntry[];
  const licenses = (licensesRes.data ?? []) as PersonLicense[];

  // Schedule attendance rollup + read-only scheduling settings for the
  // Attendance tab. Editing stays in Schedule → Setup → Employees.
  // Eligibility is editable here and writes the same rows as Schedule → Setup.
  const [attendance, scheduleSettings, eligibility] = await Promise.all([
    getPersonAttendance(id),
    getPersonScheduleSettings(id),
    getPersonEligibility(id),
  ]);

  // Linked login account (app_user), if this person has one.
  const adminClient = createAdminClient();
  const { data: accountRow } = await adminClient
    .from("app_user")
    .select("id, role, is_active")
    .eq("person_id", id)
    .maybeSingle();
  const account = (accountRow as LinkedAccount | null) ?? null;

  // Generate short-lived signed URLs for private documents.
  let documentsWithUrls: PersonDocumentWithUrl[] = documents.map((d) => ({
    ...d,
    signed_url: null,
  }));
  if (documents.length > 0) {
    const admin = createAdminClient();
    const { data: signed } = await admin.storage
      .from("employee-documents")
      .createSignedUrls(
        documents.map((d) => d.storage_path),
        60 * 60,
      );
    if (signed) {
      documentsWithUrls = documents.map((d, i) => ({
        ...d,
        signed_url: signed[i]?.signedUrl ?? null,
      }));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/hr"
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to roster
      </Link>
      {row.source_contact_id && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
          <p className="text-sm font-medium text-violet-900">
            🎓 Originated from the Student CRM
          </p>
          <Link
            href={`/crm/contact/${row.source_contact_id}`}
            className="shrink-0 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
          >
            View student record →
          </Link>
        </div>
      )}
      <EmployeeProfile
        row={row}
        reviews={reviews}
        assets={assets}
        documents={documentsWithUrls}
        recruiting={recruiting}
        attendance={attendance}
        scheduleSettings={scheduleSettings}
        eligibility={eligibility}
        ptoDays={ptoDays}
        timeOff={timeOff}
        onboarding={onboarding}
        compliance={compliance}
        licenses={licenses}
        account={account}
        canViewComp={canViewComp}
        canEdit={canEdit}
        canEditSchedule={canEditSchedule}
      />
    </div>
  );
}
