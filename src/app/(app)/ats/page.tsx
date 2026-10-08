import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule, isAdminRole } from "@/lib/auth/permissions";
import type {
  CandidateRow,
  CandidateInterviewMeta,
  CandidateTaskMeta,
  PositionRow,
} from "@/lib/ats/types";
import { loadJobHires } from "@/lib/ats/job-hires";
import { loadInterviewers, canTakeBookings } from "@/lib/ats/booking";
import { parseFields, type FormKind } from "@/lib/ats/forms";
import { appBaseUrl } from "@/lib/ats/slack-notify";
import { AtsExplorer } from "./ats-explorer";
import type { FormListRow } from "./forms-list";
import type { InterviewQueueRow, InterviewQueueStatus } from "./interview-queue";
import type { FormQueueRow } from "./form-responses-queue";
import type { RejectedRow } from "./rejected-queue";
import type { TemplateOption } from "./reject-dialog";
import { candidateJobLabel } from "@/lib/ats/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnswerValue } from "@/lib/ats/forms";
import type { Rejection } from "@/lib/ats/rejections";
import { INTERVIEW_RECOMMENDATION_LABELS } from "@/lib/ats/types";
import type { InterviewerOption, ScreeningFormOption } from "./candidate-next-steps";

export const dynamic = "force-dynamic";

export default async function AtsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "ats") : false;
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;

  const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("person")
      .select(
        `id, status, first_name, last_name, full_name, email, phone_mobile,
     phone_home, phone_other, opportunity_type, notes,
       source_contact_id, created_at, updated_at,
       person_recruiting (
         person_id, target_position_id, pipeline, stage, status_notes, source,
         application_date, interview_date, score, resume_url, keep_for_future,
         follow_up_date, notes, target_title, review_status, reviewed_at,
         reviewed_by, candidate_location, relevant_experience, education,
         job_location, interest_level, external_status, source_detail,
         screening_answers, application_history, slack_announce_ts,
         slack_announce_channel, announced_at, announced_by, created_at,
         updated_at
       )`,
      )
      .eq("status", "applicant")
      .order("last_name", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Recruiting (ATS)</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load candidates: {error.message}
        </p>
      </div>
    );
  }

  const rows: CandidateRow[] = (data ?? []).map((r) => {
    const rec = (r as { person_recruiting?: unknown }).person_recruiting;
    return {
      ...r,
      person_recruiting: Array.isArray(rec) ? (rec[0] ?? null) : (rec ?? null),
    } as CandidateRow;
  });

  // Roll up interviews per candidate for the pipeline list (next scheduled
  // date + most recent grade).
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    // Chunk the id list so neither the IN(...) URL nor the response exceeds
    // PostgREST limits (max_rows is 1000 per page).
    const ivData: {
      person_id: string;
      interview_date: string | null;
      status: string | null;
      overall_grade: string | null;
      created_at: string;
    }[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: page } = await fetchAllRows<(typeof ivData)[number]>(
        (from, to) =>
          supabase
            .from("person_interview")
            .select(
              "person_id, interview_date, status, overall_grade, created_at",
            )
            .in("person_id", chunk)
            .range(from, to),
      );
      ivData.push(...page);
    }

    if (ivData.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      type IvRow = {
        person_id: string;
        interview_date: string | null;
        status: string | null;
        overall_grade: string | null;
        created_at: string;
      };
      const byPerson = new Map<string, IvRow[]>();
      for (const iv of ivData as IvRow[]) {
        const list = byPerson.get(iv.person_id) ?? [];
        list.push(iv);
        byPerson.set(iv.person_id, list);
      }

      const metaByPerson = new Map<string, CandidateInterviewMeta>();
      for (const [personId, list] of byPerson) {
        let nextDate: string | null = null;
        for (const iv of list) {
          if (
            iv.status === "scheduled" &&
            iv.interview_date &&
            iv.interview_date >= today &&
            (nextDate === null || iv.interview_date < nextDate)
          ) {
            nextDate = iv.interview_date;
          }
        }

        const graded = list
          .filter((iv) => iv.overall_grade)
          .sort((a, b) => {
            const ad = a.interview_date ?? a.created_at;
            const bd = b.interview_date ?? b.created_at;
            return bd.localeCompare(ad);
          });

        metaByPerson.set(personId, {
          count: list.length,
          next_date: nextDate,
          last_grade: graded[0]?.overall_grade ?? null,
        });
      }

      for (const r of rows) {
        r.interview_meta = metaByPerson.get(r.id) ?? null;
      }
    }
  }

  // Open follow-up tasks per candidate (count + earliest due date) for the
  // "Follow-ups due" panel. Only open tasks, so this stays small.
  const { data: taskData } = await fetchAllRows<{ person_id: string; due_date: string | null }>(
    (from, to) =>
      supabase
        .from("recruiting_task")
        .select("person_id, due_date")
        .eq("is_done", false)
        .range(from, to),
  );
  const taskMeta = new Map<string, CandidateTaskMeta>();
  for (const t of taskData ?? []) {
    const m = taskMeta.get(t.person_id) ?? { open: 0, next_due: null };
    m.open += 1;
    if (t.due_date && (m.next_due === null || t.due_date < m.next_due)) {
      m.next_due = t.due_date;
    }
    taskMeta.set(t.person_id, m);
  }
  for (const r of rows) r.task_meta = taskMeta.get(r.id) ?? null;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const resultsSince = since.toISOString().slice(0, 10);
  const [
    { data: positionData },
    { data: roleData, error: roleError },
    { data: locationData, error: locationError },
    hires,
    { data: formData },
    { data: responseData },
    interviewerData,
    { data: queueIvData },
    { data: queueInviteData },
    { data: requestData },
    { data: rejectionData },
    { data: templateData },
  ] = await Promise.all([
      supabase.from("position").select("*").order("title", { ascending: true }),
      supabase
        .from("sched_role")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("location")
        .select("id, name")
        .eq("is_active", true)
        .eq("kind", "clinic")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      loadJobHires(supabase),
      supabase
        .from("recruiting_form")
        .select("id, kind, name, description, job_titles, slug, is_default, active, updated_at, fields")
        .order("kind")
        .order("name"),
      fetchAllRows<{ form_id: string | null }>((from, to) =>
        supabase.from("recruiting_form_response").select("form_id").range(from, to),
      ),
      loadInterviewers(),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from("person_interview")
          .select(
            "id, person_id, interview_type, interview_date, start_time, end_time, interviewer, location, host_user_id, invite_id, status, overall_grade, recommendation",
          )
          .or(
            `status.eq.scheduled,and(status.in.(completed,no_show),interview_date.gte.${resultsSince})`,
          )
          .order("interview_date", { ascending: true, nullsFirst: false })
          .range(from, to),
      ),
      supabase
        .from("interview_invite")
        .select("id, token, person_id, interview_type, duration_minutes, host_user_id, host_name, date_from, date_to, created_at")
        .eq("status", "sent")
        .order("created_at", { ascending: false }),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from("recruiting_form_request")
          .select("id, token, person_id, status, sent_at, sent_by_name, completed_at, reviewed_at, reviewed_by_name, form:form_id (name)")
          .in("status", ["sent", "completed"])
          .order("sent_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows<Rejection>((from, to) =>
        supabase
          .from("recruiting_rejection")
          .select("*")
          .is("undone_at", null)
          .order("rejected_at", { ascending: false })
          .range(from, to),
      ),
      supabase
        .from("recruiting_email_template")
        .select("id, name, active")
        .eq("kind", "rejection")
        .order("sort_order"),
    ]);

  if (roleError || locationError) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Recruiting (ATS)</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load job options: {roleError?.message ?? locationError?.message}
        </p>
      </div>
    );
  }

  const positions = (positionData ?? []) as PositionRow[];
  const roles = Array.from(
    new Map(
      ((roleData ?? []) as { id: string; name: string }[]).map((role) => [
        role.name,
        { id: role.id, name: role.name },
      ]),
    ).values(),
  );
  const locations = (locationData ?? []) as { id: string; name: string }[];

  const responseCounts = new Map<string, number>();
  for (const r of responseData ?? []) {
    if (r.form_id) responseCounts.set(r.form_id, (responseCounts.get(r.form_id) ?? 0) + 1);
  }
  const forms: FormListRow[] = (
    (formData ?? []) as (Omit<FormListRow, "question_count" | "response_count"> & { fields: unknown })[]
  ).map(({ fields, ...f }) => ({
    ...f,
    kind: f.kind as FormKind,
    question_count: parseFields(fields).filter((q) => q.type !== "section").length,
    response_count: responseCounts.get(f.id) ?? 0,
  }));
  // Shared candidate facts for the queues (people still in the ATS — hired
  // candidates have left the list).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobsById = new Map(positions.map((p) => [p.id, p]));
  const who = (personId: string) => {
    const r = byId.get(personId);
    if (!r) return null;
    const rec = r.person_recruiting;
    const job = rec?.target_position_id ? jobsById.get(rec.target_position_id) : undefined;
    return {
      candidate: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unnamed",
      has_email: Boolean(r.email),
      role: job?.title ?? rec?.target_title ?? null,
      job_label: candidateJobLabel(rec, jobsById),
      location: job?.location ?? rec?.job_location ?? rec?.candidate_location ?? null,
      score: rec?.score == null ? null : Number(rec.score),
      stage: rec?.stage ?? null,
      rejected: rec?.review_status === "declined" || rec?.stage === "Declined" || rec?.stage === "Passed",
    };
  };
  const todayIso = new Date().toISOString().slice(0, 10);

  // Interview Queue: interviews (scheduled + last 30 days of results) and
  // scheduling links the candidate hasn't booked.
  const interviewRows: InterviewQueueRow[] = [];
  for (const iv of (queueIvData ?? []) as {
    id: string;
    person_id: string;
    interview_type: string | null;
    interview_date: string | null;
    start_time: string | null;
    end_time: string | null;
    interviewer: string | null;
    location: string | null;
    host_user_id: string | null;
    invite_id: string | null;
    status: string;
    overall_grade: string | null;
    recommendation: string | null;
  }[]) {
    const p = who(iv.person_id);
    if (!p) continue;
    const status: InterviewQueueStatus =
      iv.status === "completed"
        ? "completed"
        : iv.status === "no_show"
          ? "no_show"
          : !iv.interview_date
            ? "no_date"
            : iv.interview_date < todayIso
              ? "needs_results"
              : "scheduled";
    interviewRows.push({
      id: iv.id,
      kind: "interview",
      person_id: iv.person_id,
      candidate: p.candidate,
      role: p.role,
      location: p.location,
      score: p.score,
      interview_type: iv.interview_type,
      date: iv.interview_date,
      start_time: iv.start_time,
      end_time: iv.end_time,
      date_to: null,
      interviewer: iv.interviewer,
      host_user_id: iv.host_user_id,
      status,
      stage: p.stage,
      self_booked: Boolean(iv.invite_id),
      token: null,
      grade: iv.overall_grade,
      recommendation: iv.recommendation ? (INTERVIEW_RECOMMENDATION_LABELS[iv.recommendation] ?? iv.recommendation) : null,
    });
  }
  for (const inv of (queueInviteData ?? []) as {
    id: string;
    token: string;
    person_id: string;
    interview_type: string;
    host_user_id: string;
    host_name: string | null;
    date_from: string;
    date_to: string;
  }[]) {
    const p = who(inv.person_id);
    if (!p) continue;
    interviewRows.push({
      id: inv.id,
      kind: "invite",
      person_id: inv.person_id,
      candidate: p.candidate,
      role: p.role,
      location: p.location,
      score: p.score,
      interview_type: inv.interview_type,
      date: inv.date_from,
      start_time: null,
      end_time: null,
      date_to: inv.date_to,
      interviewer: inv.host_name,
      host_user_id: inv.host_user_id,
      status: "awaiting_booking",
      stage: p.stage,
      self_booked: false,
      token: inv.token,
      grade: null,
      recommendation: null,
    });
  }

  // Form Response Queue: questionnaires waiting on the candidate or on us.
  const requests = (requestData ?? []) as {
    id: string;
    token: string;
    person_id: string;
    status: "sent" | "completed";
    sent_at: string;
    sent_by_name: string | null;
    completed_at: string | null;
    reviewed_at: string | null;
    reviewed_by_name: string | null;
    form: { name: string } | { name: string }[] | null;
  }[];
  const completedIds = requests.filter((r) => r.status === "completed").map((r) => r.id);
  const responseByRequest = new Map<string, { fields: unknown; answers: Record<string, AnswerValue> }>();
  for (let i = 0; i < completedIds.length; i += 200) {
    const { data: page } = await supabase
      .from("recruiting_form_response")
      .select("request_id, fields, answers")
      .in("request_id", completedIds.slice(i, i + 200));
    for (const r of (page ?? []) as { request_id: string; fields: unknown; answers: Record<string, AnswerValue> }[]) {
      responseByRequest.set(r.request_id, r);
    }
  }
  const formRows: FormQueueRow[] = [];
  for (const r of requests) {
    const p = who(r.person_id);
    if (!p || p.rejected) continue;
    const resp = responseByRequest.get(r.id);
    formRows.push({
      id: r.id,
      token: r.token,
      person_id: r.person_id,
      candidate: p.candidate,
      has_email: p.has_email,
      role: p.job_label,
      job_title: p.role,
      location: p.location,
      score: p.score,
      form_name: (Array.isArray(r.form) ? r.form[0]?.name : r.form?.name) ?? "Form",
      sent_at: r.sent_at,
      sent_by_name: r.sent_by_name,
      status: r.status === "sent" ? "waiting" : r.reviewed_at ? "reviewed" : "needs_review",
      completed_at: r.completed_at,
      reviewed_by_name: r.reviewed_by_name,
      response: resp ? { fields: parseFields(resp.fields, { allowCore: true }), answers: resp.answers } : null,
    });
  }

  // Rejected queue.
  const rejectedRows: RejectedRow[] = [];
  for (const r of rejectionData ?? []) {
    const r0 = byId.get(r.person_id);
    rejectedRows.push({
      ...r,
      candidate: r0 ? r0.full_name || [r0.first_name, r0.last_name].filter(Boolean).join(" ") || "Unnamed" : "Former candidate",
      role: r0 ? candidateJobLabel(r0.person_recruiting, jobsById) : null,
      still_rejected:
        !!r0 &&
        (r0.person_recruiting?.stage ?? null) === r.rejected_stage &&
        r0.person_recruiting?.review_status !== "pending",
    });
  }
  const templates = (templateData ?? []) as TemplateOption[];

  // Resume links for the Review Queue cards (newest resume, signed for a day).
  const resumeLinks: Record<string, string> = {};
  const pendingIds = rows.filter((r) => r.person_recruiting?.review_status === "pending").map((r) => r.id);
  if (pendingIds.length) {
    const admin = createAdminClient();
    const newest = new Map<string, string>();
    for (let i = 0; i < pendingIds.length; i += 200) {
      const { data: docs } = await admin
        .from("person_document")
        .select("person_id, storage_path, uploaded_at")
        .in("person_id", pendingIds.slice(i, i + 200))
        .ilike("category", "resume")
        .order("uploaded_at", { ascending: false });
      for (const d of (docs ?? []) as { person_id: string; storage_path: string }[]) {
        if (!newest.has(d.person_id)) newest.set(d.person_id, d.storage_path);
      }
    }
    const entries = [...newest.entries()];
    if (entries.length) {
      const { data: signed } = await admin.storage
        .from("employee-documents")
        .createSignedUrls(entries.map(([, path]) => path), 60 * 60 * 24);
      entries.forEach(([personId], i) => {
        const url = signed?.[i]?.signedUrl;
        if (url) resumeLinks[personId] = url;
      });
    }
  }

  const screeningForms: ScreeningFormOption[] = forms
    .filter((f) => f.kind === "screening" && f.active)
    .map((f) => ({ id: f.id, name: f.name, job_titles: f.job_titles }));
  const interviewers: InterviewerOption[] = interviewerData.map((i) => ({
    user_id: i.user_id,
    name: i.name,
    bookable: canTakeBookings(i),
    google_connected: i.google_connected,
    default_duration: i.default_duration,
  }));

  return (
    <AtsExplorer
      rows={rows}
      positions={positions}
      hires={hires}
      forms={forms}
      screeningForms={screeningForms}
      interviewers={interviewers}
      interviewRows={interviewRows}
      formRows={formRows}
      rejectedRows={rejectedRows}
      templates={templates}
      resumeLinks={resumeLinks}
      currentUserId={current?.authId ?? null}
      currentUserName={current?.appUser.full_name ?? null}
      origin={appBaseUrl()}
      initialTab={typeof tab === "string" ? tab : undefined}
      roles={roles}
      locations={locations}
      canEdit={canEdit}
      isAdmin={isAdmin}
    />
  );
}
