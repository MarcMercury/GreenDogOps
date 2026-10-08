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
  "Interview",
  "Shadow Day",
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

  if (toStage === "Offer") return `💼 *APPROVED FOR OFFER — ${esc(name)}*${from}${by}`;
  if (toStage === "Hired") return `🎉 ${who} moved to ${stage}${from}${by}`;

  const closing = toStage ? CLOSING_STAGE_EMOJI[toStage] : undefined;
  if (closing) return `${closing} ${who} moved to ${stage}${from}${by}`;

  const toIdx = toStage ? FORWARD_STAGES.indexOf(toStage) : -1;
  const fromIdx = fromStage ? FORWARD_STAGES.indexOf(fromStage) : -1;
  if (toIdx >= 0 && toIdx < fromIdx) return `↩️ ${who} moved back to ${stage}${from}${by}`;
  if (toIdx > 0) return `⭐ ${who} advanced to ${stage}${from}${by}`;
  return `${who} moved to ${stage}${from}${by}`;
}

/** "💼 *Jane Doe* moved to job *Vet Tech — Venice* (from CSR — Van Nuys) — Marc". */
export function buildJobChangeMessage(
  name: string,
  fromJob: string | null,
  toJob: string | null,
  actorName: string | null,
): string {
  const by = actorName ? ` — ${esc(actorName)}` : "";
  const who = `*${esc(name)}*`;
  if (!toJob) {
    return `💼 ${who} removed from job${fromJob ? ` *${esc(fromJob)}*` : ""}${by}`;
  }
  const from = fromJob ? ` (from ${esc(fromJob)})` : "";
  return `💼 ${who} ${fromJob ? "moved to" : "assigned to"} job *${esc(toJob)}*${from}${by}`;
}

const INTERVIEW_HEADINGS: Record<string, { emoji: string; title: string; withLabel: string }> = {
  phone_screen: { emoji: "📞", title: "PHONE INTERVIEW SCHEDULED", withLabel: "Interviewer" },
  in_person: { emoji: "👋", title: "IN-PERSON / SHADOW SCHEDULED", withLabel: "With" },
  working_interview: { emoji: "👋", title: "IN-PERSON / SHADOW SCHEDULED", withLabel: "With" },
  final: { emoji: "🗓️", title: "FINAL INTERVIEW SCHEDULED", withLabel: "With" },
};

/** "Tuesday, October 13" from a date-only "2026-10-13". */
function longDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * 📞 *PHONE INTERVIEW SCHEDULED*
 * Jane Doe
 * Tuesday, October 13 · 11:30 AM
 * *Interviewer: Sarah*
 *
 * In-person / shadow days post with 👋 and the location. Falls back to
 * whoever scheduled it when no interviewer was entered.
 */
export function buildInterviewScheduledMessage(
  name: string,
  iv: Pick<
    PersonInterview,
    "interview_type" | "interview_date" | "start_time" | "end_time" | "interviewer" | "location"
  >,
  scheduledBy?: string | null,
): string {
  const heading = (iv.interview_type && INTERVIEW_HEADINGS[iv.interview_type]) || {
    emoji: "🗓️",
    title: `${(iv.interview_type ? (INTERVIEW_TYPE_LABELS[iv.interview_type] ?? iv.interview_type) : "Interview").toUpperCase()} SCHEDULED`,
    withLabel: "With",
  };
  const when = [longDate(iv.interview_date), formatTime(iv.start_time)].filter(Boolean).join(" · ");
  const interviewer = iv.interviewer?.trim() || null;
  const lines = [`${heading.emoji} *${esc(heading.title)}*`, esc(name)];
  if (when) lines.push(esc(when));
  if (iv.location?.trim() && iv.interview_type !== "phone_screen") lines.push(esc(iv.location.trim()));
  if (interviewer) lines.push(`*${heading.withLabel}: ${esc(interviewer)}*`);
  else if (scheduledBy) lines.push(`_Scheduled by ${esc(scheduledBy)}_`);
  return lines.join("\n");
}

/** ⭐ after an interview is marked completed: grade + recommendation. */
export function buildInterviewCompletedMessage(
  name: string,
  iv: Pick<PersonInterview, "interview_type" | "interviewer" | "overall_grade" | "recommendation">,
  recommendationLabel: string | null,
): string {
  const type = iv.interview_type
    ? (INTERVIEW_TYPE_LABELS[iv.interview_type] ?? iv.interview_type)
    : "Interview";
  const details = [
    iv.overall_grade ? `Grade ${esc(iv.overall_grade)}` : null,
    recommendationLabel ? `Recommendation: *${esc(recommendationLabel)}*` : null,
    iv.interviewer?.trim() ? esc(iv.interviewer.trim()) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `⭐ *${esc(type)} completed — ${esc(name)}*${details ? `\n${details}` : ""}`;
}

/** 📝 when a screening questionnaire is sent. */
export function buildFormSentMessage(name: string, formName: string, actorName: string | null): string {
  return `📝 *Questionnaire sent — ${esc(formName)}*\n${esc(name)}${actorName ? ` · sent by ${esc(actorName)}` : ""}`;
}

/** ✅ when the candidate completes it, with a link to their answers. */
export function buildFormCompletedMessage(name: string, formName: string, url: string): string {
  return `✅ *Questionnaire completed — ${esc(formName)}*\n${esc(name)} · <${url}|View answers>`;
}
