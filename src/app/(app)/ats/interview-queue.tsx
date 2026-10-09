"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column, type FilterDef } from "../_components/data-views";
import { INTERVIEW_TYPE_LABELS, formatTime } from "@/lib/ats/types";
import { compareQueueRows } from "@/lib/ats/interview-queue";
import { ScoreControl } from "./score-control";

export type InterviewQueueStatus = "needs_results" | "scheduled" | "awaiting_booking" | "no_date" | "completed" | "no_show";

/** One interview or one unbooked scheduling link, flattened for the queue. */
export interface InterviewQueueRow {
  id: string;
  kind: "interview" | "invite";
  person_id: string;
  candidate: string;
  role: string | null;
  location: string | null;
  score: number | null;
  interview_type: string | null;
  /** Interview date, or the first offered date for a link. */
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  date_to: string | null;
  interviewer: string | null;
  host_user_id: string | null;
  status: InterviewQueueStatus;
  stage: string | null;
  self_booked: boolean;
  token: string | null;
  grade: string | null;
  recommendation: string | null;
}

export const INTERVIEW_STATUS_QUEUE_LABELS: Record<InterviewQueueStatus, string> = {
  needs_results: "Needs results",
  scheduled: "Scheduled",
  awaiting_booking: "Awaiting booking",
  no_date: "Scheduled — no date",
  completed: "Completed",
  no_show: "No show",
};

const STATUS_BADGE: Record<InterviewQueueStatus, string> = {
  needs_results: "bg-rose-100 text-rose-700",
  scheduled: "bg-emerald-100 text-emerald-800",
  awaiting_booking: "bg-amber-100 text-amber-800",
  no_date: "bg-amber-50 text-amber-700",
  completed: "bg-slate-100 text-slate-600",
  no_show: "bg-slate-200 text-slate-600",
};

const TYPE_STYLE: Record<string, { icon: string; badge: string }> = {
  phone_screen: { icon: "📞", badge: "bg-sky-100 text-sky-800" },
  virtual: { icon: "💻", badge: "bg-cyan-100 text-cyan-800" },
  in_person: { icon: "👋", badge: "bg-violet-100 text-violet-800" },
  working_interview: { icon: "👥", badge: "bg-amber-100 text-amber-800" },
  final: { icon: "⭐", badge: "bg-emerald-100 text-emerald-800" },
  doc_call: { icon: "🩺", badge: "bg-pink-100 text-pink-800" },
  other: { icon: "🗓️", badge: "bg-slate-100 text-slate-700" },
};

function typeLabel(t: string | null | undefined): string {
  return t ? (INTERVIEW_TYPE_LABELS[t] ?? t) : "Type not set";
}

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDay(date: string, today: string): string {
  if (date === today) return "Today";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(`${window.location.origin}/book/${token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

/**
 * Interview Queue — the working list for everyone actively interviewing:
 * scheduled interviews, ones needing results, and scheduling links the
 * candidate hasn't booked yet. Defaults to date/time order; sort by any
 * column; filter by type, date, status, interviewer, role, location, score
 * and stage. Scores edit inline.
 */
export function InterviewQueue({
  rows,
  currentUserId,
  currentUserName,
  canEdit,
}: {
  rows: InterviewQueueRow[];
  currentUserId: string | null;
  currentUserName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const today = localDate(0);
  const weekOut = localDate(7);
  const me = currentUserName?.trim().toLowerCase() ?? null;
  const isMine = (r: InterviewQueueRow) =>
    (!!currentUserId && r.host_user_id === currentUserId) || (!!me && (r.interviewer ?? "").trim().toLowerCase() === me);

  const isDone = (r: InterviewQueueRow) => r.status === "completed" || r.status === "no_show";
  const active = rows.filter((r) => !isDone(r));
  const counts = {
    needs: active.filter((r) => r.status === "needs_results").length,
    today: active.filter((r) => r.kind === "interview" && r.date === today).length,
    upcoming: active.filter((r) => r.status === "scheduled" && r.date && r.date > today).length,
    awaiting: active.filter((r) => r.status === "awaiting_booking").length,
  };

  const visible = rows
    .filter((r) => showDone || !isDone(r))
    .filter((r) => !mine || isMine(r))
    .sort(compareQueueRows);

  const columns: Column<InterviewQueueRow>[] = [
    {
      key: "candidate",
      header: "Candidate",
      value: (r) => r.candidate,
      render: (r) => <span className="font-medium text-slate-900">{r.candidate}</span>,
    },
    { key: "role", header: "Role", value: (r) => r.role },
    { key: "location", header: "Location", value: (r) => r.location },
    {
      key: "score",
      header: "Score",
      value: (r) => r.score,
      render: (r) => <ScoreControl personId={r.person_id} score={r.score} canEdit={canEdit} />,
    },
    {
      key: "type",
      header: "Interview Type",
      value: (r) => typeLabel(r.interview_type),
      render: (r) => {
        const s = r.interview_type ? TYPE_STYLE[r.interview_type] : undefined;
        return (
          <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s?.badge ?? "bg-slate-100 text-slate-500"}`}>
            {s ? `${s.icon} ` : ""}
            {typeLabel(r.interview_type)}
          </span>
        );
      },
    },
    {
      key: "when",
      header: "Date / Time",
      value: (r) => (r.date ? `${r.date} ${r.start_time ?? ""}` : null),
      render: (r) => {
        if (r.kind === "invite") {
          return (
            <span className="text-xs text-slate-500">
              Offered {r.date ? fmtDay(r.date, today) : ""} – {r.date_to ? fmtDay(r.date_to, today) : ""}
            </span>
          );
        }
        if (!r.date) return <span className="text-xs text-amber-700">No date</span>;
        const s = formatTime(r.start_time);
        return (
          <span className={`whitespace-nowrap ${r.status === "needs_results" ? "text-rose-700" : ""}`}>
            <span className="font-medium">{fmtDay(r.date, today)}</span>
            {s && <span className="text-slate-500"> · {s}</span>}
          </span>
        );
      },
    },
    { key: "interviewer", header: "Interviewer", value: (r) => r.interviewer },
    {
      key: "status",
      header: "Interview Status",
      value: (r) => INTERVIEW_STATUS_QUEUE_LABELS[r.status],
      render: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>
            {INTERVIEW_STATUS_QUEUE_LABELS[r.status]}
          </span>
          {r.self_booked && <span className="text-[11px] text-emerald-700">self-booked</span>}
          {isDone(r) && (r.grade || r.recommendation) && (
            <span className="text-[11px] text-slate-500">
              {[r.grade && `Grade ${r.grade}`, r.recommendation].filter(Boolean).join(" · ")}
            </span>
          )}
          {r.token && <CopyLink token={r.token} />}
        </span>
      ),
    },
    { key: "stage", header: "Current Stage", value: (r) => r.stage },
  ];

  const filters: FilterDef<InterviewQueueRow>[] = [
    { key: "type", label: "Type", value: (r) => typeLabel(r.interview_type) },
    { key: "status", label: "Status", value: (r) => INTERVIEW_STATUS_QUEUE_LABELS[r.status] },
    {
      key: "date",
      label: "Date",
      value: (r) =>
        !r.date || r.kind === "invite"
          ? null
          : r.date < today
            ? "Past"
            : r.date === today
              ? "Today"
              : r.date <= weekOut
                ? "Next 7 days"
                : "Later",
    },
    { key: "interviewer", label: "Interviewer", value: (r) => r.interviewer },
    { key: "role", label: "Role", value: (r) => r.role },
    { key: "location", label: "Location", value: (r) => r.location },
    {
      key: "score",
      label: "Score",
      value: (r) => (r.score == null ? "Unscored" : r.score >= 8 ? "8–10" : r.score >= 6 ? "6–7.9" : "Under 6"),
    },
    { key: "stage", label: "Stage", value: (r) => r.stage },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Needs results", value: counts.needs, tone: counts.needs ? "text-rose-700" : "text-slate-400" },
          { label: "Today", value: counts.today, tone: "text-emerald-700" },
          { label: "Upcoming", value: counts.upcoming, tone: "text-violet-700" },
          { label: "Awaiting candidate booking", value: counts.awaiting, tone: "text-amber-700" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
          Only my interviews
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
          Include completed / no-shows (last 30 days)
        </label>
      </div>
      <DataTable
        rows={visible}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search candidate, role, interviewer…"
        onRowClick={(r) =>
          router.push(
            r.kind === "interview"
              ? `/ats/${r.person_id}?tab=interviews&interview=${r.id}`
              : `/ats/${r.person_id}?tab=interviews`,
          )
        }
        emptyLabel="No interviews in the queue. Use 📅 Invite to schedule on a candidate's Interview Tracking tab."
      />
    </div>
  );
}
