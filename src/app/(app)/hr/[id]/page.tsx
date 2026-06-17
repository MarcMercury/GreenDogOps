import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  RosterRow,
  PersonReview,
  PersonAsset,
  PersonDocument,
  PersonDocumentWithUrl,
  PersonRecruitingSummary,
} from "@/lib/hr/types";
import { redactCompensation } from "@/lib/hr/types";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { EmployeeProfile } from "./employee-profile";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;

  const { data, error } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, preferred_name, grid_name, full_name,
       email, phone_mobile, phone_home, phone_other, date_of_birth, postal_code, work_location_type,
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
  const row = isAdmin ? rawRow : redactCompensation(rawRow);

  const recruitingRaw = Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null);
  const recruiting = recruitingRaw as PersonRecruitingSummary | null;

  // Sub-records for the Reviews / Assets / Documents tabs.
  const [reviewsRes, assetsRes, docsRes] = await Promise.all([
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
  ]);

  const reviews = (reviewsRes.data ?? []) as PersonReview[];
  const assets = (assetsRes.data ?? []) as PersonAsset[];
  const documents = (docsRes.data ?? []) as PersonDocument[];

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
      <EmployeeProfile
        row={row}
        reviews={reviews}
        assets={assets}
        documents={documentsWithUrls}
        recruiting={recruiting}
        isAdmin={isAdmin}
      />
    </div>
  );
}
