// ---------------------------------------------------------------------------
// Slack message text for automated recruiting-thread updates. Pure functions
// (no server-only imports) so the wording can be unit-tested; posting lives in
// ./slack-notify.ts.
// ---------------------------------------------------------------------------

import type { PersonInterview } from "./types";
import { INTERVIEW_TYPE_LABELS, formatTime } from "./types";

// Slack mrkdwn treats &, < and > as control characters.
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// The forward path through the pipeline, in order. Moving later in this list
// is "advancing"; the closing stages (Hold, No Response, Passed, Declined)
// sit outside it.
const FORWARD_STAGES = [
  "New Lead",
  "Contacted",
  "Phone Screen",
  "Zoom/Virtual Interview",
  "In-Person / Shadow Day",
  "Doc Call",
  "Offer",
  "Hired",
];

const CLOSING_STAGE_EMOJI: Record<string, string> = {
  "Hold for Future": "⏸️",
  "No Response": "📵",
  Passed: "🚫",
  Declined: "🚫",
};

export function buildStageChangeMessage(
  name: string,
  fromStage: string | null,
  toStage: string | null,
  actorName: string | null,
): string {
  const from = fromStage ? ` (from ${esc(fromStage)})` : "";
  const by = actorName ? ` — ${esc(actorName)}` : "";
  const who = `*${esc(name)}*`;
  const stage = `*${esc(toStage ?? "no stage")}*`;

  if (toStage === "Offer") return `💼 ${who} approved for an offer${from}${by}`;
  if (toStage === "Hired") return `🎉 ${who} moved to ${stage}${from}${by}`;

  const closing = toStage ? CLOSING_STAGE_EMOJI[toStage] : undefined;
  if (closing) return `${closing} ${who} moved to ${stage}${from}${by}`;

  const toIdx = toStage ? FORWARD_STAGES.indexOf(toStage) : -1;
  const fromIdx = fromStage ? FORWARD_STAGES.indexOf(fromStage) : -1;
  if (toIdx >= 0 && toIdx < fromIdx) return `↩️ ${who} moved back to ${stage}${from}${by}`;
  if (toIdx > 0) return `⭐ ${who} advanced to ${stage}${from}${by}`;
  return `${who} moved to ${stage}${from}${by}`;
}

const INTERVIEW_EMOJI: Record<string, string> = {
  phone_screen: "☎️",
  in_person: "👋",
  working_interview: "👋",
};

/**
 * "☎️ Phone Screen scheduled — Jane Doe / Sarah is interviewing Jane Doe ·
 * Tue, Oct 7 · 10:00 AM–10:30 AM · Zoom". Falls back to whoever scheduled it
 * when no interviewer was entered.
 */
export function buildInterviewScheduledMessage(
  name: string,
  iv: Pick<
    PersonInterview,
    "interview_type" | "interview_date" | "start_time" | "end_time" | "interviewer" | "location"
  >,
  scheduledBy?: string | null,
): string {
  const type = iv.interview_type
    ? (INTERVIEW_TYPE_LABELS[iv.interview_type] ?? iv.interview_type)
    : "Interview";
  const emoji = (iv.interview_type && INTERVIEW_EMOJI[iv.interview_type]) || "🗓️";
  const start = formatTime(iv.start_time);
  const end = formatTime(iv.end_time);
  const time = start ? (end ? `${start}–${end}` : start) : null;
  const interviewer = iv.interviewer?.trim() || null;
  const who = interviewer
    ? `${esc(interviewer)} is interviewing ${esc(name)}`
    : scheduledBy
      ? `Scheduled by ${esc(scheduledBy)}`
      : null;
  const details = [who, ...[fmtDate(iv.interview_date), time, iv.location].filter(Boolean).map((s) => esc(String(s)))]
    .filter(Boolean)
    .join(" · ");
  return `${emoji} *${esc(type)} scheduled — ${esc(name)}*${details ? `\n${details}` : ""}`;
}
