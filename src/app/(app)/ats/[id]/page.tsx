import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { isSlackConfigured } from "@/lib/slack/client";
import type {
  CandidateRow,
  PersonInterview,
  PositionRow,
  RecruitingActivity,
  RecruitingTask,
} from "@/lib/ats/types";
import type { PersonDocument, PersonDocumentWithUrl } from "@/lib/hr/types";
import type { ProfileTransition } from "@/lib/shared/transitions";
import { hiresSinceOpened } from "@/lib/ats/jobs";
import { loadJobHires } from "@/lib/ats/job-hires";
import { loadInterviewers, canTakeBookings } from "@/lib/ats/booking";
import { parseFields, type FormRequest, type FormResponse } from "@/lib/ats/forms";
import { CandidateProfile, type ProfileInvite } from "./candidate-profile";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "ats") : false;

  const { data, error } = await supabase
    .from("person")
    .select(
      `id, status, first_name, last_name, full_name, email, phone_mobile,
     phone_home, phone_other, date_of_birth, postal_code, opportunity_type, notes,
       source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         application_date, interview_date, score, resume_url, keep_for_future,
         follow_up_date, notes, target_title, review_status, reviewed_at,
         reviewed_by, candidate_location, relevant_experience, education,
         job_location, interest_level, external_status, source_detail,
         screening_answers, application_history, application, slack_announce_ts,
         slack_announce_channel, announced_at, announced_by, created_at,
         updated_at
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load candidate: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const rec = (data as { person_recruiting?: unknown }).person_recruiting;
  const row: CandidateRow = {
    ...data,
    person_recruiting: Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null),
  } as CandidateRow;

  const { data: interviewData } = await supabase
    .from("person_interview")
    .select("*")
    .eq("person_id", id)
    .order("interview_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const interviews = (interviewData ?? []) as PersonInterview[];

  // Documents (attachments) live on the shared person_document rows in the
  // private employee-documents bucket — the same ones HR reads once hired.
  const { data: docsData } = await supabase
    .from("person_document")
    .select("*")
    .eq("person_id", id)
    .order("uploaded_at", { ascending: false });
  const documents = (docsData ?? []) as PersonDocument[];

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

  // Stage-movement history (Student CRM → ATS → Roster) for the History tab.
  const { data: transitionData } = await supabase
    .from("profile_transition_log")
    .select("*")
    .eq("person_id", id)
    .order("created_at", { ascending: false });
  const transitions = (transitionData ?? []) as ProfileTransition[];

  const [{ data: activityData }, { data: taskData }, { data: positionData }] =
    await Promise.all([
      supabase
        .from("recruiting_activity")
        .select("*")
        .eq("person_id", id)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("recruiting_task")
        .select("*")
        .eq("person_id", id)
        .order("is_done", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("position").select("*").order("title", { ascending: true }),
    ]);
  const [{ data: responseData }, { data: requestData }, { data: inviteData }, { data: formData }, interviewerData] =
    await Promise.all([
      supabase
        .from("recruiting_form_response")
        .select("*")
        .eq("person_id", id)
        .order("submitted_at", { ascending: false }),
      supabase
        .from("recruiting_form_request")
        .select("id, token, form_id, person_id, status, sent_to, sent_at, sent_by_name, completed_at, form:form_id (name)")
        .eq("person_id", id)
        .order("sent_at", { ascending: false }),
      supabase
        .from("interview_invite")
        .select("id, token, interview_type, duration_minutes, host_name, date_from, date_to, status, booked_start, created_at, created_by_name")
        .eq("person_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("recruiting_form")
        .select("id, name, job_titles")
        .eq("kind", "screening")
        .eq("active", true)
        .order("name"),
      loadInterviewers(),
    ]);
  const formResponses = ((responseData ?? []) as FormResponse[]).map((r) => ({
    ...r,
    fields: parseFields(r.fields, { allowCore: true }),
  }));
  const formRequests = ((requestData ?? []) as (FormRequest & { form: { name: string } | { name: string }[] | null })[]).map(
    ({ form, ...r }) => ({ ...r, form_name: (Array.isArray(form) ? form[0]?.name : form?.name) ?? "Form" }),
  );
  const invites = (inviteData ?? []) as ProfileInvite[];
  const screeningForms = (formData ?? []) as { id: string; name: string; job_titles: string[] }[];
  const interviewers = interviewerData.map((i) => ({
    user_id: i.user_id,
    name: i.name,
    bookable: canTakeBookings(i),
    google_connected: i.google_connected,
    default_duration: i.default_duration,
  }));
  const activities = (activityData ?? []) as RecruitingActivity[];
  const tasks = (taskData ?? []) as RecruitingTask[];
  const positions = (positionData ?? []) as PositionRow[];

  // How many hires the candidate's job already has, so Hire can offer to close
  // the job when this one fills the last opening.
  const job = positions.find((p) => p.id === row.person_recruiting?.target_position_id);
  const jobHireCount = job
    ? hiresSinceOpened(await loadJobHires(supabase, job.id), job).length
    : 0;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/ats" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to recruiting
      </Link>
      {row.source_contact_id && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
          <p className="text-sm font-medium text-violet-900">
            🎓 Promoted from the Student CRM
          </p>
          <Link
            href={`/crm/contact/${row.source_contact_id}`}
            className="shrink-0 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
          >
            View student record →
          </Link>
        </div>
      )}
      <CandidateProfile
        row={row}
        interviews={interviews}
        documents={documentsWithUrls}
        transitions={transitions}
        activities={activities}
        tasks={tasks}
        positions={positions}
        jobHireCount={jobHireCount}
        formResponses={formResponses}
        formRequests={formRequests}
        invites={invites}
        screeningForms={screeningForms}
        interviewers={interviewers}
        currentUserId={current?.authId ?? null}
        initialTab={typeof tab === "string" ? tab : undefined}
        canEdit={canEdit}
        slackEnabled={canEdit && isSlackConfigured()}
      />
    </div>
  );
}
