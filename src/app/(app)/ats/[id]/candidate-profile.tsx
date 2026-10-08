"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type {
  CandidateRow,
  PersonInterview,
  PositionRow,
  RecruitingActivity,
  RecruitingTask,
} from "@/lib/ats/types";
import {
  ACTIVITY_TYPE_LABELS,
  formatTime,
  INTERVIEW_TYPE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUS_BADGE,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_GRADE_OPTIONS,
  CSR_PHONE_SCREEN_QUESTIONS,
} from "@/lib/ats/types";
import type { PersonDocumentWithUrl } from "@/lib/hr/types";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/hr/types";
import type { ProfileTransition } from "@/lib/shared/transitions";
import { transitionEventLabel, stageLabel } from "@/lib/shared/transitions";
import { CandidateForm, type CandidateFormTab } from "./candidate-form";
import { JobQuickSelect } from "../job-quick-select";
import { applicationHasData } from "@/lib/ats/application";
import { CopyForSlackButton } from "./copy-for-slack";
import { PostToSlackButton } from "./post-to-slack";
import { buildInterviewSummary } from "@/lib/ats/slack-summary";
import {
  saveInterview,
  deleteInterview,
  uploadCandidateDocument,
  deleteCandidateDocument,
  postInterviewSummaryToSlack,
  addRecruitingActivity,
  deleteRecruitingActivity,
  addRecruitingTask,
  toggleRecruitingTask,
  deleteRecruitingTask,
  type SaveResult,
} from "../actions";

type TabKey =
  | "profile"
  | "application"
  | "experience"
  | "interviews"
  | "activity"
  | "documents"
  | "history";

// "profile" stays the Overview key so existing ?tab=profile links still work.
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Overview" },
  { key: "application", label: "Application" },
  { key: "experience", label: "Experience & Skills" },
  { key: "interviews", label: "Interview Tracking" },
  { key: "activity", label: "Activity & Tasks" },
  { key: "documents", label: "Documents" },
  { key: "history", label: "History" },
];

export function CandidateProfile({
  row,
  interviews,
  documents,
  transitions,
  activities,
  tasks,
  positions,
  jobHireCount = 0,
  initialTab,
  canEdit = false,
  slackEnabled = false,
}: {
  row: CandidateRow;
  interviews: PersonInterview[];
  documents: PersonDocumentWithUrl[];
  transitions: ProfileTransition[];
  activities: RecruitingActivity[];
  tasks: RecruitingTask[];
  positions: PositionRow[];
  /** Hires into the candidate's job since it was last opened. */
  jobHireCount?: number;
  /** From `?tab=` — the explorer's follow-up links open straight to Activity. */
  initialTab?: string;
  canEdit?: boolean;
  slackEnabled?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "profile",
  );
  const openTasks = tasks.filter((t) => !t.is_done).length;
  const rec = row.person_recruiting;
  const hasApplication = applicationHasData(rec?.application);
  const formTab: CandidateFormTab | null =
    activeTab === "profile" || activeTab === "application" || activeTab === "experience"
      ? activeTab
      : null;

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate";

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job</span>
            <JobQuickSelect
              key={rec?.target_position_id ?? ""}
              personId={row.id}
              jobId={rec?.target_position_id ?? null}
              jobs={positions}
              fallbackLabel={rec?.target_title}
              canEdit={canEdit && row.status === "applicant"}
              size="md"
            />
            {rec?.pipeline && <span>· {rec.pipeline}</span>}
            {rec?.candidate_location && <span>· 📍 {rec.candidate_location}</span>}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            const count =
              t.key === "interviews"
                ? interviews.length
                : t.key === "activity"
                  ? openTasks
                  : t.key === "documents"
                    ? documents.length
                    : 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
                {t.key === "application" && hasApplication && (
                  <span
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                    title="Website application on file"
                  />
                )}
                {count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* One form spans Overview / Application / Experience and stays mounted,
          so unsaved edits survive a tab switch and one Save covers all three. */}
      <CandidateForm
        row={row}
        canEdit={canEdit}
        slackEnabled={slackEnabled}
        positions={positions}
        jobHireCount={jobHireCount}
        tab={formTab}
        onNavigate={setActiveTab}
      />

      {activeTab === "interviews" && (
        <InterviewsPanel
          row={row}
          interviews={interviews}
          canEdit={canEdit}
          slackEnabled={slackEnabled}
        />
      )}

      {activeTab === "activity" && (
        <ActivityTasksPanel
          personId={row.id}
          activities={activities}
          tasks={tasks}
          canEdit={canEdit}
        />
      )}

      {activeTab === "documents" && (
        <DocumentsPanel
          personId={row.id}
          documents={documents}
          canEdit={canEdit}
        />
      )}

      {activeTab === "history" && <TransitionLogPanel transitions={transitions} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function DeleteButton({
  onConfirm,
  label = "this item",
}: {
  onConfirm: () => void;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          start(() => onConfirm());
        }
      }}
      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Interview tracking
// ---------------------------------------------------------------------------

function InterviewsPanel({
  row,
  interviews,
  canEdit = false,
  slackEnabled = false,
}: {
  row: CandidateRow;
  interviews: PersonInterview[];
  canEdit?: boolean;
  slackEnabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      {canEdit && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Schedule / log an interview
          </h2>
          <p className="mb-4 text-xs text-slate-400">
            Scheduled interviews show on the calendar
            {slackEnabled ? " and post to the candidate's Slack thread" : ""}.
          </p>
          <InterviewForm personId={row.id} />
        </section>
      )}

      {interviews.length === 0 ? (
        <EmptyState>No interviews logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {interviews.map((iv) => (
            <InterviewCard
              key={iv.id}
              row={row}
              interview={iv}
              canEdit={canEdit}
              slackEnabled={slackEnabled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const typeOptions = Object.entries(INTERVIEW_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const statusOptions = Object.entries(INTERVIEW_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const recommendationOptions = Object.entries(INTERVIEW_RECOMMENDATION_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const gradeOptions = INTERVIEW_GRADE_OPTIONS.map((g) => ({ value: g, label: g }));

/** Add a new interview, or edit an existing one when `interview` is passed. */
function InterviewForm({
  personId,
  interview,
  onDone,
}: {
  personId: string;
  interview?: PersonInterview;
  onDone?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveInterview(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (!result?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [result, onDone]);

  // Editing keeps the questions the interview was logged with; new interviews
  // start from the CSR phone-screen set.
  const questions =
    interview && interview.responses.length > 0
      ? interview.responses.map((r) => r.question)
      : CSR_PHONE_SCREEN_QUESTIONS;
  const answerFor = (i: number) => interview?.responses[i]?.answer ?? "";

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {interview && <input type="hidden" name="interview_id" value={interview.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Interview date"
          name="interview_date"
          type="date"
          defaultValue={interview?.interview_date ?? undefined}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Start"
            name="start_time"
            type="time"
            defaultValue={interview?.start_time?.slice(0, 5)}
          />
          <Field
            label="End"
            name="end_time"
            type="time"
            defaultValue={interview?.end_time?.slice(0, 5)}
          />
        </div>
        <Select
          label="Type"
          name="interview_type"
          options={typeOptions}
          defaultValue={interview?.interview_type ?? undefined}
        />
        <Select
          label="Status"
          name="status"
          options={statusOptions}
          defaultValue={interview?.status ?? "scheduled"}
        />
        <Field
          label="Interviewer"
          name="interviewer"
          defaultValue={interview?.interviewer ?? undefined}
        />
        <Field
          label="Location"
          name="location"
          defaultValue={interview?.location ?? undefined}
        />
        <Select
          label="Overall grade"
          name="overall_grade"
          options={gradeOptions}
          defaultValue={interview?.overall_grade ?? undefined}
        />
        <Select
          label="Recommendation"
          name="recommendation"
          options={recommendationOptions}
          defaultValue={interview?.recommendation ?? undefined}
        />
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <span className="text-xs font-medium text-slate-500">Summary / overall notes</span>
          <textarea
            name="summary"
            rows={3}
            defaultValue={interview?.summary ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60">
        <button
          type="button"
          onClick={() => setShowQuestions((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-slate-700"
        >
          <span>
            {interview && interview.responses.length > 0
              ? "Interview questions"
              : "CSR phone-screen questions (optional)"}
          </span>
          <span className="text-slate-400">{showQuestions ? "▲" : "▼"}</span>
        </button>
        <div className={showQuestions ? "space-y-3 px-4 pb-4" : "hidden"}>
          {questions.map((q, i) => (
            <label key={i} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">
                {i + 1}. {q}
              </span>
              <input type="hidden" name={`question_${i}`} value={q} />
              <textarea
                name={`answer_${i}`}
                rows={2}
                defaultValue={answerFor(i)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <AddButton>{interview ? "Save changes" : "Add interview"}</AddButton>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
        {result?.ok === false && <span className="text-sm text-red-600">{result.error}</span>}
      </div>
    </form>
  );
}

function InterviewCard({
  row,
  interview,
  canEdit = false,
  slackEnabled = false,
}: {
  row: CandidateRow;
  interview: PersonInterview;
  canEdit?: boolean;
  slackEnabled?: boolean;
}) {
  const personId = row.id;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const answered = (interview.responses ?? []).filter((r) => r.answer);
  const statusBadge =
    INTERVIEW_STATUS_BADGE[interview.status] ?? "bg-slate-100 text-slate-500";
  const start = formatTime(interview.start_time);
  const end = formatTime(interview.end_time);
  const timeRange = start ? (end ? `${start}–${end}` : start) : null;

  if (editing) {
    return (
      <li className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
        <InterviewForm
          personId={personId}
          interview={interview}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {interview.interview_type
              ? (INTERVIEW_TYPE_LABELS[interview.interview_type] ??
                interview.interview_type)
              : "Interview"}
            {interview.overall_grade && (
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                Grade {interview.overall_grade}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmtDate(interview.interview_date)}
            {timeRange ? ` · ${timeRange}` : ""}
            {interview.interviewer ? ` · ${interview.interviewer}` : ""}
            {interview.location ? ` · ${interview.location}` : ""}
            {interview.recommendation
              ? ` · ${INTERVIEW_RECOMMENDATION_LABELS[interview.recommendation] ?? interview.recommendation}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}
          >
            {INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status}
          </span>
          <CopyForSlackButton
            label="Copy summary"
            getText={() => buildInterviewSummary(row, interview)}
          />
          {slackEnabled && (
            <PostToSlackButton
              label="Post summary"
              confirmMessage={
                row.person_recruiting?.slack_announce_ts
                  ? "Post this interview summary in the candidate's Slack thread?"
                  : "Post this interview summary to the Slack hiring channel?"
              }
              onPost={() => postInterviewSummaryToSlack(personId, interview.id)}
            />
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
            >
              Edit
            </button>
          )}
          {canEdit && (
            <DeleteButton
              label="this interview"
              onConfirm={() => deleteInterview(personId, interview.id)}
            />
          )}
        </div>
      </div>

      {interview.summary && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
          {interview.summary}
        </p>
      )}

      {answered.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            {open ? "Hide" : "Show"} responses ({answered.length})
          </button>
          {open && (
            <dl className="mt-2 space-y-2">
              {answered.map((r, i) => (
                <div key={i}>
                  <dt className="text-xs font-semibold text-slate-600">
                    {r.question}
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm text-slate-700">
                    {r.answer}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Activity & follow-up tasks (in-app only — never posted to Slack)
// ---------------------------------------------------------------------------

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateTime(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ACTIVITY_ICON: Record<string, string> = {
  call: "📞",
  text: "💬",
  email: "✉️",
  note: "📝",
};

function ActivityTasksPanel({
  personId,
  activities,
  tasks,
  canEdit,
}: {
  personId: string;
  activities: RecruitingActivity[];
  tasks: RecruitingTask[];
  canEdit: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <TasksSection personId={personId} tasks={tasks} canEdit={canEdit} />
      <ActivitySection personId={personId} activities={activities} canEdit={canEdit} />
    </div>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

function TasksSection({
  personId,
  tasks,
  canEdit,
}: {
  personId: string;
  tasks: RecruitingTask[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => addRecruitingTask(personId, prev, fd),
    null,
  );
  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);
  const today = localToday();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Follow-up tasks
      </h2>
      {canEdit && (
        <form ref={formRef} action={formAction} className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              name="title"
              required
              placeholder="e.g. Call back re: shadow day"
              className={`${inputCls} min-w-0 flex-1`}
            />
            <input name="due_date" type="date" className={inputCls} />
          </div>
          <textarea name="details" rows={2} placeholder="Details (optional)" className={`${inputCls} w-full`} />
          <div className="flex items-center gap-3">
            <AddButton>Add task</AddButton>
            {result?.ok === false && <span className="text-sm text-red-600">{result.error}</span>}
          </div>
        </form>
      )}
      {tasks.length === 0 ? (
        <EmptyState>No follow-ups yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => (
            <TaskItem key={t.id} personId={personId} task={t} today={today} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskItem({
  personId,
  task,
  today,
  canEdit,
}: {
  personId: string;
  task: RecruitingTask;
  today: string;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(task.is_done);
  const overdue = !done && task.due_date != null && task.due_date < today;
  const dueToday = !done && task.due_date === today;

  return (
    <li className="flex items-start gap-3 py-2.5">
      <input
        type="checkbox"
        checked={done}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const next = e.target.checked;
          setDone(next);
          start(async () => {
            const res = await toggleRecruitingTask(personId, task.id, next);
            if (!res.ok) {
              setDone(!next);
              alert(res.error);
            }
          });
        }}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? "text-slate-400 line-through" : "font-medium text-slate-900"}`}>
          {task.title}
        </p>
        {task.details && (
          <p className="whitespace-pre-wrap text-xs text-slate-500">{task.details}</p>
        )}
        <p className="mt-0.5 text-xs text-slate-400">
          {task.due_date && (
            <span
              className={
                overdue ? "font-semibold text-red-600" : dueToday ? "font-semibold text-amber-600" : ""
              }
            >
              {overdue ? "Overdue · " : dueToday ? "Due today · " : "Due "}
              {fmtDate(task.due_date)}
            </span>
          )}
          {task.due_date && task.created_by_name ? " · " : ""}
          {task.created_by_name ?? ""}
        </p>
      </div>
      {canEdit && (
        <DeleteButton
          label="this task"
          onConfirm={async () => {
            const res = await deleteRecruitingTask(personId, task.id);
            if (!res.ok) alert(res.error);
          }}
        />
      )}
    </li>
  );
}

function ActivitySection({
  personId,
  activities,
  canEdit,
}: {
  personId: string;
  activities: RecruitingActivity[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => addRecruitingActivity(personId, prev, fd),
    null,
  );
  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Activity log
      </h2>
      {canEdit && (
        <form ref={formRef} action={formAction} className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select name="activity_type" defaultValue="call" className={inputCls}>
              {Object.entries(ACTIVITY_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              name="occurred_at"
              type="datetime-local"
              title="When it happened (defaults to now)"
              className={`${inputCls} min-w-0 flex-1`}
            />
          </div>
          <textarea
            name="body"
            required
            rows={2}
            placeholder="Left VM, will try again tomorrow…"
            className={`${inputCls} w-full`}
          />
          <div className="flex items-center gap-3">
            <AddButton>Log activity</AddButton>
            {result?.ok === false && <span className="text-sm text-red-600">{result.error}</span>}
          </div>
        </form>
      )}
      {activities.length === 0 ? (
        <EmptyState>No calls, texts or notes logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="text-base leading-6" aria-hidden>
                {ACTIVITY_ICON[a.activity_type] ?? "📝"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400">
                  <span className="font-medium text-slate-600">
                    {ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}
                  </span>
                  {" · "}
                  {fmtDateTime(a.occurred_at)}
                  {a.created_by_name ? ` · ${a.created_by_name}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{a.body}</p>
              </div>
              {canEdit && (
                <DeleteButton
                  label="this entry"
                  onConfirm={async () => {
                    const res = await deleteRecruitingActivity(personId, a.id);
                    if (!res.ok) alert(res.error);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents (attachments)
// ---------------------------------------------------------------------------

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsPanel({
  personId,
  documents,
  canEdit,
}: {
  personId: string;
  documents: PersonDocumentWithUrl[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => uploadCandidateDocument(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Upload a document
          </h2>
          <form
            ref={formRef}
            action={formAction}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Field label="Title" name="title" />
            <Select
              label="Category"
              name="category"
              options={Object.entries(DOCUMENT_CATEGORY_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">File</span>
              <input
                name="file"
                type="file"
                required
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <AddButton>Upload</AddButton>
              <span className="text-xs text-slate-400">
                Max 25 MB. Files follow the candidate into the Roster when hired.
              </span>
              {result?.ok === false && (
                <span className="text-sm text-red-600">{result.error}</span>
              )}
            </div>
          </form>
        </section>
      )}

      {documents.length === 0 ? (
        <EmptyState>No documents uploaded yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {d.signed_url ? (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:text-emerald-900 hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {d.category
                    ? (DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category)
                    : "Uncategorized"}
                  {d.file_name ? ` · ${d.file_name}` : ""}
                  {d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}
                  {` · ${fmtDate(d.uploaded_at)}`}
                  {d.source ? ` · ${d.source}` : ""}
                </p>
              </div>
              {canEdit && (
                <DeleteButton
                  label="this document"
                  onConfirm={() =>
                    deleteCandidateDocument(personId, d.id, d.storage_path)
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History — profile stage-movement log
// ---------------------------------------------------------------------------

function TransitionLogPanel({
  transitions,
}: {
  transitions: ProfileTransition[];
}) {
  if (transitions.length === 0) {
    return <EmptyState>No stage movements recorded yet.</EmptyState>;
  }
  return (
    <ol className="space-y-3">
      {transitions.map((t) => {
        const from = stageLabel(t.from_stage);
        const to = stageLabel(t.to_stage);
        return (
          <li
            key={t.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {transitionEventLabel(t.event_type)}
              </p>
              <span className="text-xs text-slate-500">
                {fmtDate(t.created_at)}
              </span>
            </div>
            {(from || to) && (
              <p className="mt-1 text-xs text-slate-500">
                {from ?? "—"} → {to ?? "—"}
              </p>
            )}
            {t.detail && (
              <p className="mt-1 text-sm text-slate-700">{t.detail}</p>
            )}
            {t.actor_name && (
              <p className="mt-1 text-xs text-slate-400">by {t.actor_name}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
