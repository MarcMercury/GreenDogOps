"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CandidateRow,
  type PositionRow,
  bucketForStage,
  positionLabel,
  STAGE_BUCKET_LABELS,
} from "@/lib/ats/types";
import { candidateJobLabel, type JobHire } from "@/lib/ats/jobs";
import {
  type Stat,
  type Column,
  type FilterDef,
  StatGrid,
  DataTable,
  ModuleHeader,
  exportColumnsCsv,
} from "../_components/data-views";
import { ImportDialog } from "./import-dialog";
import { AddCandidateDialog } from "./add-candidate-dialog";
import { IntakeReview } from "./intake-review";
import { StageQuickSelect } from "./stage-quick-select";
import { JobsBoard } from "./jobs-board";
import { JobQuickSelect } from "./job-quick-select";
import { FormsList, type FormListRow } from "./forms-list";
import { InterviewQueue, type QueueInterview, type QueueInvite } from "./interview-queue";
import type { InterviewerOption, ScreeningFormOption } from "./candidate-next-steps";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AtsExplorer({
  rows,
  positions,
  hires,
  forms,
  screeningForms,
  interviewers,
  queueInterviews,
  queueInvites,
  currentUserId,
  currentUserName,
  origin,
  initialTab,
  roles,
  locations,
  canEdit,
  isAdmin,
}: {
  rows: CandidateRow[];
  positions: PositionRow[];
  hires: JobHire[];
  forms: FormListRow[];
  screeningForms: ScreeningFormOption[];
  interviewers: InterviewerOption[];
  queueInterviews: QueueInterview[];
  queueInvites: QueueInvite[];
  currentUserId: string | null;
  currentUserName: string | null;
  origin: string;
  initialTab?: string;
  roles: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Split auto-intake awaiting triage (pending) from the active pipeline
  // (accepted + declined + legacy). The Review tab handles the queue.
  // Order the queue newest-first to mirror the email inbox: application_date is
  // derived from each message's internalDate, with created_at breaking same-day
  // ties in ingestion order.
  const reviewRows = rows
    .filter((r) => r.person_recruiting?.review_status === "pending")
    .sort((a, b) => {
      const ad = a.person_recruiting?.application_date ?? a.created_at;
      const bd = b.person_recruiting?.application_date ?? b.created_at;
      if (ad !== bd) return bd.localeCompare(ad);
      return b.created_at.localeCompare(a.created_at);
    });
  const pipelineRows = rows.filter(
    (r) => r.person_recruiting?.review_status !== "pending",
  );

  type Tab = "pipeline" | "review" | "interviews" | "jobs" | "forms";
  const [tab, setTab] = useState<Tab>(
    initialTab === "review" || initialTab === "interviews" || initialTab === "jobs" || initialTab === "forms"
      ? initialTab
      : "pipeline",
  );
  // Badge: interviews needing results plus today's.
  const interviewsDue = queueInterviews.filter(
    (i) => i.interview_date != null && i.interview_date <= localToday(),
  ).length;

  const jobsById = new Map(positions.map((p) => [p.id, p]));
  // "CSR — Van Nuys", "CSR — Van Nuys (closed)", or "No job" — for the Job
  // filter, sorting and the CSV export.
  const jobValue = (r: CandidateRow): string => {
    const id = r.person_recruiting?.target_position_id;
    const job = id ? jobsById.get(id) : undefined;
    if (!job) return "No job";
    return `${positionLabel(job)}${job.status === "closed" ? " (closed)" : ""}`;
  };

  const counts: Record<string, number> = {};
  for (const r of pipelineRows) {
    const b = bucketForStage(r.person_recruiting?.stage ?? null);
    counts[b] = (counts[b] ?? 0) + 1;
  }

  const upcomingInterviews = pipelineRows.filter(
    (r) => r.interview_meta?.next_date,
  ).length;

  // Candidates with an open follow-up due today or earlier.
  const today = localToday();
  const followUpsDue = rows
    .filter((r) => r.task_meta?.next_due && r.task_meta.next_due <= today)
    .sort((a, b) => (a.task_meta!.next_due!).localeCompare(b.task_meta!.next_due!));

  const openJobs = positions.filter((p) => p.status === "open").length;

  const stats: Stat[] = [
    { label: "Total", value: String(pipelineRows.length), tone: "text-emerald-700" },
    { label: "Active", value: String(counts.active ?? 0), tone: "text-emerald-600" },
    { label: "Interviews Set", value: String(upcomingInterviews), tone: "text-violet-700" },
    { label: "Follow-ups Due", value: String(followUpsDue.length), tone: "text-amber-700" },
    { label: "Hired", value: String(counts.hired ?? 0), tone: "text-indigo-700" },
    { label: "Keep for Future", value: String(counts.future ?? 0), tone: "text-sky-700" },
    { label: "Passed", value: String(counts.passed ?? 0), tone: "text-red-600" },
  ];

  const columns: Column<CandidateRow>[] = [
    {
      key: "name",
      header: "Name",
      value: candidateName,
      render: (r) => (
        <span className="font-medium text-slate-900">{candidateName(r)}</span>
      ),
    },
    {
      key: "job",
      header: "Job",
      value: (r) =>
        r.person_recruiting?.target_position_id
          ? jobValue(r)
          : (r.person_recruiting?.target_title ?? null),
      render: (r) => (
        <JobQuickSelect
          key={`${r.id}:${r.person_recruiting?.target_position_id ?? ""}`}
          personId={r.id}
          jobId={r.person_recruiting?.target_position_id ?? null}
          jobs={positions}
          fallbackLabel={r.person_recruiting?.target_title}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "stage",
      header: "Stage",
      value: (r) => r.person_recruiting?.stage,
      render: (r) => (
        <StageQuickSelect
          key={`${r.id}:${r.person_recruiting?.stage ?? ""}`}
          personId={r.id}
          stage={r.person_recruiting?.stage ?? null}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "source",
      header: "Source",
      value: (r) => r.person_recruiting?.source,
    },
    {
      key: "candidate_location",
      header: "City",
      value: (r) => r.person_recruiting?.candidate_location,
    },
    {
      key: "relevant_experience",
      header: "Experience",
      value: (r) => r.person_recruiting?.relevant_experience,
    },
    {
      key: "score",
      header: "Score",
      value: (r) => {
        const s = r.person_recruiting?.score;
        return s != null && s > 0 ? s : null;
      },
      className: "tabular-nums",
    },
    {
      key: "next_interview",
      header: "Next Interview",
      value: (r) => fmtDate(r.interview_meta?.next_date),
      render: (r) => {
        const d = fmtDate(r.interview_meta?.next_date);
        return d ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
            📅 {d}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      key: "grade",
      header: "Grade",
      value: (r) => r.interview_meta?.last_grade ?? null,
      render: (r) => {
        const g = r.interview_meta?.last_grade;
        return g ? (
          <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
            {g}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
      className: "text-center",
    },
  ];

  const filters: FilterDef<CandidateRow>[] = [
    { key: "job", label: "Job", value: jobValue },
    {
      key: "stage_group",
      label: "Stage",
      value: (r) => STAGE_BUCKET_LABELS[bucketForStage(r.person_recruiting?.stage ?? null)],
    },
    {
      key: "score",
      label: "Score",
      value: (r) => {
        const s = r.person_recruiting?.score;
        return s != null && s > 0 ? String(s) : null;
      },
    },
    {
      key: "interest_level",
      label: "Interest",
      value: (r) => r.person_recruiting?.interest_level,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon="🎯"
        eyebrow="Recruiting"
        title="Recruiting (ATS)"
        onExport={() => exportColumnsCsv("recruiting-ats", columns, pipelineRows)}
        actions={
          <>
            <button
              onClick={() => setImportOpen(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              ⬆ Import
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              + Add
            </button>
          </>
        }
      />

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <AddCandidateDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        positions={positions}
      />

      {/* Tabs: active pipeline vs. the auto-intake review queue. */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("pipeline")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === "pipeline"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          All Candidates
        </button>
        <button
          onClick={() => setTab("review")}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === "review"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Review Queue
          {reviewRows.length > 0 && (
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
              {reviewRows.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("interviews")}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === "interviews"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Interview Queue
          {interviewsDue > 0 && (
            <span
              title="Today's interviews and ones needing results"
              className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-violet-600 px-1.5 text-xs font-semibold text-white"
            >
              {interviewsDue}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === "jobs"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Jobs
          {openJobs > 0 && (
            <span
              title={`${openJobs} open`}
              className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-200 px-1.5 text-xs font-semibold text-slate-700"
            >
              {openJobs}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("forms")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === "forms"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Forms
        </button>
        <Link
          href="/ats/availability"
          className="-mb-px ml-auto self-center rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          📅 My Availability
        </Link>
      </div>

      {tab === "review" ? (
        <IntakeReview
          rows={reviewRows}
          positions={positions}
          canEdit={canEdit}
          screeningForms={screeningForms}
          interviewers={interviewers}
          currentUserId={currentUserId}
        />
      ) : tab === "interviews" ? (
        <InterviewQueue
          interviews={queueInterviews}
          invites={queueInvites}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      ) : tab === "forms" ? (
        <FormsList forms={forms} origin={origin} canEdit={canEdit} />
      ) : tab === "jobs" ? (
        <JobsBoard
          origin={origin}
          positions={positions}
          rows={rows}
          hires={hires}
          roles={roles}
          locations={locations}
          canEdit={canEdit}
          isAdmin={isAdmin}
        />
      ) : (
        <>
          <StatGrid stats={stats} compact />

          {followUpsDue.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                ⏰ Follow-ups due
              </p>
              <ul className="flex flex-wrap gap-2">
                {followUpsDue.map((r) => {
                  const due = r.task_meta!.next_due!;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/ats/${r.id}?tab=activity`}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm transition hover:border-amber-400"
                      >
                        <span className="font-medium">{candidateName(r)}</span>
                        <span
                          className={`text-xs ${due < today ? "font-semibold text-red-600" : "text-amber-700"}`}
                        >
                          {due < today ? `overdue · ${fmtDate(due)}` : "today"}
                        </span>
                        {r.task_meta!.open > 1 && (
                          <span className="text-xs text-slate-400">
                            {r.task_meta!.open} open
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <DataTable
            rows={pipelineRows}
            columns={columns}
            filters={filters}
            searchPlaceholder="Search name, job, source…"
            searchExtra={(r) => [
              r.email,
              candidateJobLabel(r.person_recruiting, jobsById),
              r.person_recruiting?.target_title,
              r.person_recruiting?.pipeline,
              r.person_recruiting?.source,
              r.person_recruiting?.job_location,
              r.person_recruiting?.status_notes,
            ]}
            onRowClick={(r) => router.push(`/ats/${r.id}`)}
            emptyLabel="No candidates match your filters."
          />
        </>
      )}
    </div>
  );
}
