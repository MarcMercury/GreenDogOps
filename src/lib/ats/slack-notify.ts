import "server-only";

// ---------------------------------------------------------------------------
// Automated Slack posts for the recruiting channel.
//
// The team announces each candidate with a numbered "NEW (<POSITION>)
// CANDIDATE ANNOUNCEMENT" post and then discusses them in that post's thread.
// `announceCandidate` posts that announcement and stores its ts; afterwards
// every stage change and newly scheduled interview replies in the same thread
// (or posts top-level when the candidate was never announced).
//
// Kept separate from ./slack-summary.ts, which the client-side copy button
// imports.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { postSlackMessage, isSlackConfigured } from "@/lib/slack/client";
import { recordAudit } from "@/lib/auth/session";
import type { CandidateRow, PersonInterview } from "./types";
import { INTERVIEW_TYPE_LABELS, formatTime } from "./types";

/** Public origin for links back into the app, without a trailing slash. */
export function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

export function candidateProfileUrl(personId: string): string {
  return `${appBaseUrl()}/ats/${personId}`;
}

// Slack mrkdwn treats &, < and > as control characters.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function candidateName(row: Pick<CandidateRow, "full_name" | "first_name" | "last_name">): string {
  return (
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate"
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The team's numbered announcement post, with an @channel ping. */
export function buildAnnouncementMessage(
  row: CandidateRow,
  resumeLink: string | null,
  profileUrl: string,
): string {
  const rec = row.person_recruiting;
  const position = (rec?.target_title ?? "").trim().toUpperCase() || "IN-HOUSE";
  const notes = (rec?.notes ?? rec?.status_notes ?? row.notes ?? "").trim();
  const phone = row.phone_mobile ?? row.phone_home ?? row.phone_other;
  const links = [
    resumeLink ? `<${resumeLink}|Resume>` : null,
    `<${profileUrl}|Open in GreenDogOps>`,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `<!channel> *NEW (${esc(position)}) CANDIDATE ANNOUNCEMENT*`,
    `1. NOTES: ${notes ? esc(notes) : "—"}`,
    `2. NAME: ${esc(candidateName(row))}`,
    `3. PHONE: ${phone ? esc(phone) : "—"}`,
    `4. EMAIL: ${row.email ? esc(row.email) : "—"}`,
    `5. LOCATION: ${rec?.candidate_location ? esc(rec.candidate_location) : "—"}`,
    `6. RESUME & INT LINK: ${links}`,
  ].join("\n");
}

export function buildStageChangeMessage(
  name: string,
  fromStage: string | null,
  toStage: string | null,
  actorName: string | null,
): string {
  const from = fromStage ? ` (from ${esc(fromStage)})` : "";
  const by = actorName ? ` — ${esc(actorName)}` : "";
  return `*${esc(name)}* moved to *${esc(toStage ?? "no stage")}*${from}${by}`;
}

export function buildInterviewScheduledMessage(
  name: string,
  iv: Pick<
    PersonInterview,
    "interview_type" | "interview_date" | "start_time" | "end_time" | "interviewer" | "location"
  >,
): string {
  const type = iv.interview_type
    ? (INTERVIEW_TYPE_LABELS[iv.interview_type] ?? iv.interview_type)
    : "Interview";
  const start = formatTime(iv.start_time);
  const end = formatTime(iv.end_time);
  const time = start ? (end ? `${start}–${end}` : start) : null;
  const details = [
    fmtDate(iv.interview_date),
    time,
    iv.interviewer ? `with ${iv.interviewer}` : null,
    iv.location,
  ]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  return `🗓️ *${esc(type)} scheduled — ${esc(name)}*${details ? `\n${details}` : ""}`;
}

/**
 * Post an update about a candidate, threaded under their announcement when one
 * exists. Best-effort: never throws, and does nothing when Slack isn't set up.
 */
export async function notifyCandidateThread(input: {
  personId: string;
  text: string;
  username?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<void> {
  if (!isSlackConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("person_recruiting")
      .select("slack_announce_ts")
      .eq("person_id", input.personId)
      .maybeSingle();
    const threadTs =
      (data as { slack_announce_ts?: string | null } | null)?.slack_announce_ts ?? undefined;

    const result = await postSlackMessage({
      channelKey: "hiring",
      text: input.text,
      username: input.username,
      threadTs,
    });
    if (!result.ok) {
      console.error("[ats] Slack notify failed:", result.error);
      return;
    }
    if (input.actorId && input.actorEmail) {
      await recordAudit({
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        action: "slack.post",
        entity: "person",
        entityId: input.personId,
        summary: threadTs ? "Posted candidate update to Slack thread" : "Posted candidate update to Slack",
        metadata: { channel: result.channel, ts: result.ts, thread_ts: threadTs ?? null },
      });
    }
  } catch (err) {
    console.error("[ats] Slack notify failed:", err);
  }
}
