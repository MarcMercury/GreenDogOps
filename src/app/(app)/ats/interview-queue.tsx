"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { INTERVIEW_TYPE_LABELS, formatTime } from "@/lib/ats/types";

/** One scheduled interview, flattened for the queue. */
export interface QueueInterview {
  id: string;
  person_id: string;
  candidate: string;
  job: string | null;
  stage: string | null;
  interview_type: string | null;
  interview_date: string | null;
  start_time: string | null;
  end_time: string | null;
  interviewer: string | null;
  location: string | null;
  host_user_id: string | null;
  self_booked: boolean;
}

/** A scheduling link the candidate hasn't booked yet. */
export interface QueueInvite {
  id: string;
  token: string;
  person_id: string;
  candidate: string;
  job: string | null;
  interview_type: string;
  duration_minutes: number;
  host_user_id: string;
  host_name: string | null;
  date_from: string;
  date_to: string;
  created_at: string;
}

const TYPE_STYLE: Record<string, { icon: string; badge: string; short: string }> = {
  phone_screen: { icon: "📞", badge: "bg-sky-100 text-sky-800", short: "Phone" },
  in_person: { icon: "👋", badge: "bg-violet-100 text-violet-800", short: "In-person" },
  working_interview: { icon: "🐾", badge: "bg-amber-100 text-amber-800", short: "Shadow day" },
  final: { icon: "⭐", badge: "bg-emerald-100 text-emerald-800", short: "Final" },
  other: { icon: "🗓️", badge: "bg-slate-100 text-slate-700", short: "Other" },
};
const UNSET = "unset";

function typeKey(t: string | null | undefined): string {
  return t && TYPE_STYLE[t] ? t : UNSET;
}

function TypeBadge({ type }: { type: string | null | undefined }) {
  const s = type ? TYPE_STYLE[type] : undefined;
  return (
    <span
      title={type ? (INTERVIEW_TYPE_LABELS[type] ?? type) : "Type not set"}
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s?.badge ?? "bg-slate-100 text-slate-500"}`}
    >
      {s ? `${s.icon} ${s.short}` : "— Type not set"}
    </span>
  );
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(date: string, today: string): string {
  const dt = new Date(`${date}T00:00:00`);
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const base = dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  if (date === today) return `Today · ${base}`;
  if (dt.getTime() === tomorrow.getTime()) return `Tomorrow · ${base}`;
  return base;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeRange(iv: QueueInterview): string {
  const s = formatTime(iv.start_time);
  const e = formatTime(iv.end_time);
  return s ? (e ? `${s} – ${e}` : s) : "Time not set";
}

function byWhen(a: QueueInterview, b: QueueInterview): number {
  return (
    (a.interview_date ?? "").localeCompare(b.interview_date ?? "") ||
    (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
  );
}

function InterviewRow({ iv, showDate, overdue }: { iv: QueueInterview; showDate?: boolean; overdue?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <div className="w-40 shrink-0 tabular-nums">
        {showDate && iv.interview_date && (
          <div className={`text-xs font-semibold ${overdue ? "text-rose-700" : "text-slate-500"}`}>
            {shortDate(iv.interview_date)}
          </div>
        )}
        <div className="font-medium text-slate-900">{timeRange(iv)}</div>
      </div>
      <div className="min-w-[12rem] flex-1">
        <Link href={`/ats/${iv.person_id}?tab=interviews`} className="font-medium text-slate-900 hover:text-emerald-700">
          {iv.candidate}
        </Link>
        <div className="text-xs text-slate-500">
          {[iv.job, iv.stage].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <TypeBadge type={iv.interview_type} />
      <div className="w-36 truncate text-slate-700" title={iv.interviewer ?? undefined}>
        {iv.interviewer ? `with ${iv.interviewer}` : <span className="text-slate-400">No interviewer</span>}
      </div>
      <div className="w-44 truncate text-xs text-slate-500" title={iv.location ?? undefined}>
        {iv.location ?? ""}
        {iv.self_booked && (
          <span className="ml-1 rounded bg-emerald-50 px-1 py-0.5 text-[11px] font-medium text-emerald-700">self-booked</span>
        )}
      </div>
      <Link
        href={`/ats/${iv.person_id}?tab=interviews`}
        className={`ml-auto whitespace-nowrap text-xs font-semibold ${overdue ? "text-rose-700 hover:text-rose-900" : "text-emerald-700 hover:text-emerald-900"}`}
      >
        {overdue ? "Log results →" : "Open →"}
      </Link>
    </li>
  );
}

function Section({
  title,
  hint,
  tone = "slate",
  count,
  children,
}: {
  title: string;
  hint?: string;
  tone?: "slate" | "rose" | "emerald" | "amber";
  count: number;
  children: React.ReactNode;
}) {
  const head = {
    slate: "text-slate-600",
    rose: "text-rose-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className={`text-sm font-semibold uppercase tracking-wide ${head}`}>{title}</h2>
        <span className="text-xs tabular-nums text-slate-400">{count}</span>
        {hint && <span className="text-xs text-slate-400">· {hint}</span>}
      </div>
      {children}
    </section>
  );
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
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
 * Interview Queue — every scheduled interview and every scheduling link still
 * waiting on the candidate, in one list: what needs results, what's today,
 * what's coming up.
 */
export function InterviewQueue({
  interviews,
  invites,
  currentUserId,
  currentUserName,
}: {
  interviews: QueueInterview[];
  invites: QueueInvite[];
  currentUserId: string | null;
  currentUserName: string | null;
}) {
  const [type, setType] = useState<string>("all");
  const [who, setWho] = useState<string>("all");
  const [q, setQ] = useState("");
  const today = localToday();
  const me = currentUserName?.trim().toLowerCase() ?? null;

  const interviewerNames = useMemo(
    () =>
      [
        ...new Set(
          [...interviews.map((i) => i.interviewer), ...invites.map((i) => i.host_name)]
            .map((n) => n?.trim())
            .filter((n): n is string => !!n),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [interviews, invites],
  );

  const isMine = (hostId: string | null, name: string | null) =>
    (!!currentUserId && hostId === currentUserId) || (!!me && (name ?? "").trim().toLowerCase() === me);
  const matches = (t: string | null, hostId: string | null, name: string | null, candidate: string, job: string | null) => {
    if (type !== "all" && typeKey(t) !== type) return false;
    if (who === "me" && !isMine(hostId, name)) return false;
    if (who !== "all" && who !== "me" && (name ?? "").trim() !== who) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !`${candidate} ${job ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  };

  const shown = interviews
    .filter((i) => matches(i.interview_type, i.host_user_id, i.interviewer, i.candidate, i.job))
    .sort(byWhen);
  const shownInvites = invites.filter((i) =>
    matches(i.interview_type, i.host_user_id, i.host_name, i.candidate, i.job),
  );

  const overdue = shown.filter((i) => i.interview_date && i.interview_date < today);
  const todays = shown.filter((i) => i.interview_date === today);
  const upcoming = shown.filter((i) => i.interview_date && i.interview_date > today);
  const undated = shown.filter((i) => !i.interview_date);
  const upcomingDays = [...new Set(upcoming.map((i) => i.interview_date!))];

  const typeCounts = new Map<string, number>();
  for (const i of interviews) typeCounts.set(typeKey(i.interview_type), (typeCounts.get(typeKey(i.interview_type)) ?? 0) + 1);

  const chip = (value: string, label: string, n?: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setType(value)}
      aria-pressed={type === value}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        type === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
      {n != null && n > 0 && <span className="ml-1 opacity-70">{n}</span>}
    </button>
  );

  const empty = shown.length === 0 && shownInvites.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Needs results", value: overdue.length, tone: overdue.length ? "text-rose-700" : "text-slate-400" },
          { label: "Today", value: todays.length, tone: "text-emerald-700" },
          { label: "Upcoming", value: upcoming.length, tone: "text-violet-700" },
          { label: "Waiting on candidate", value: shownInvites.length, tone: "text-amber-700" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chip("all", "All types")}
        {Object.entries(TYPE_STYLE).map(([k, s]) => chip(k, `${s.icon} ${s.short}`, typeCounts.get(k)))}
        {typeCounts.get(UNSET) ? chip(UNSET, "Type not set", typeCounts.get(UNSET)) : null}
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="all">All interviewers</option>
          <option value="me">Me</option>
          {interviewerNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search candidate or job…"
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {empty && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
          No interviews scheduled{type !== "all" || who !== "all" || q ? " that match these filters" : ""}. Use{" "}
          <strong>📅 Invite to schedule</strong> on a candidate&apos;s Interview Tracking tab to send them times.
        </p>
      )}

      {overdue.length > 0 && (
        <Section title="⚠️ Needs results" hint="date has passed — log the grade, recommendation and status" tone="rose" count={overdue.length}>
          <ul className="divide-y divide-rose-100 overflow-hidden rounded-xl border border-rose-200 bg-rose-50/40 shadow-sm">
            {overdue.map((iv) => (
              <InterviewRow key={iv.id} iv={iv} showDate overdue />
            ))}
          </ul>
        </Section>
      )}

      {todays.length > 0 && (
        <Section title={dayLabel(today, today)} tone="emerald" count={todays.length}>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
            {todays.map((iv) => (
              <InterviewRow key={iv.id} iv={iv} />
            ))}
          </ul>
        </Section>
      )}

      {upcomingDays.length > 0 && (
        <Section title="Upcoming" count={upcoming.length}>
          <div className="space-y-3">
            {upcomingDays.map((d) => (
              <div key={d}>
                <p className="mb-1 text-xs font-semibold text-slate-500">{dayLabel(d, today)}</p>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {upcoming
                    .filter((iv) => iv.interview_date === d)
                    .map((iv) => (
                      <InterviewRow key={iv.id} iv={iv} />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {undated.length > 0 && (
        <Section title="Scheduled — no date yet" tone="amber" count={undated.length}>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
            {undated.map((iv) => (
              <InterviewRow key={iv.id} iv={iv} />
            ))}
          </ul>
        </Section>
      )}

      {shownInvites.length > 0 && (
        <Section title="⏳ Waiting on candidate to book" hint="scheduling link sent, no time picked yet" tone="amber" count={shownInvites.length}>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
            {shownInvites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="w-40 shrink-0 text-xs text-slate-500">
                  Sent {shortDate(inv.created_at.slice(0, 10))}
                  <div className="text-slate-400">
                    offers {shortDate(inv.date_from)} – {shortDate(inv.date_to)}
                  </div>
                </div>
                <div className="min-w-[12rem] flex-1">
                  <Link href={`/ats/${inv.person_id}?tab=interviews`} className="font-medium text-slate-900 hover:text-emerald-700">
                    {inv.candidate}
                  </Link>
                  <div className="text-xs text-slate-500">{inv.job ?? "—"}</div>
                </div>
                <TypeBadge type={inv.interview_type} />
                <div className="w-36 truncate text-slate-700">
                  {inv.host_name ? `with ${inv.host_name}` : ""}
                  <span className="text-xs text-slate-400"> · {inv.duration_minutes} min</span>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  {inv.date_to < today && (
                    <span className="text-xs font-medium text-rose-700">Range has passed — resend</span>
                  )}
                  <CopyLink token={inv.token} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
