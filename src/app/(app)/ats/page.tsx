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
import type { QueueInterview, QueueInvite } from "./interview-queue";
import { candidateJobLabel } from "@/lib/ats/jobs";
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
            "id, person_id, interview_type, interview_date, start_time, end_time, interviewer, location, host_user_id, invite_id",
          )
          .eq("status", "scheduled")
          .order("interview_date", { ascending: true, nullsFirst: false })
          .range(from, to),
      ),
      supabase
        .from("interview_invite")
        .select("id, token, person_id, interview_type, duration_minutes, host_user_id, host_name, date_from, date_to, created_at")
        .eq("status", "sent")
        .order("created_at", { ascending: false }),
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
  // Interview Queue: scheduled interviews and unbooked scheduling links for
  // people still in the ATS (hired candidates have left the list).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobsById = new Map(positions.map((p) => [p.id, p]));
  const who = (personId: string) => {
    const r = byId.get(personId);
    if (!r) return null;
    return {
      candidate: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unnamed",
      job: candidateJobLabel(r.person_recruiting, jobsById),
      stage: r.person_recruiting?.stage ?? null,
    };
  };
  const queueInterviews: QueueInterview[] = [];
  for (const iv of (queueIvData ?? []) as (Omit<QueueInterview, "candidate" | "job" | "stage" | "self_booked"> & {
    invite_id: string | null;
  })[]) {
    const p = who(iv.person_id);
    if (!p) continue;
    const { invite_id, ...rest } = iv;
    queueInterviews.push({ ...rest, ...p, self_booked: Boolean(invite_id) });
  }
  const queueInvites: QueueInvite[] = [];
  for (const inv of (queueInviteData ?? []) as Omit<QueueInvite, "candidate" | "job">[]) {
    const p = who(inv.person_id);
    if (p) queueInvites.push({ ...inv, candidate: p.candidate, job: p.job });
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
      queueInterviews={queueInterviews}
      queueInvites={queueInvites}
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
