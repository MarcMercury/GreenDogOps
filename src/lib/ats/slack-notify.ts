import "server-only";

// ---------------------------------------------------------------------------
// Automated Slack posts for the recruiting channel.
//
// The team announces each candidate with a numbered "NEW (<POSITION>)
// CANDIDATE ANNOUNCEMENT" post and then discusses them in that post's thread.
// Accepting an applicant from the Review Queue posts that announcement
// automatically (the profile's Announce button covers anyone accepted another
// way) and stores its ts; afterwards every stage change and newly scheduled
// interview replies in the same thread (or posts top-level when the candidate
// was never announced).
//
// Kept separate from ./slack-summary.ts, which the client-side copy button
// imports.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { postSlackMessage, isSlackConfigured } from "@/lib/slack/client";
import { recordAudit } from "@/lib/auth/session";
import type { CandidateRow } from "./types";
import { esc } from "./slack-messages";
import { candidateJobLabel } from "./jobs";

export { buildInterviewScheduledMessage, buildStageChangeMessage } from "./slack-messages";

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

export function candidateName(row: Pick<CandidateRow, "full_name" | "first_name" | "last_name">): string {
  return (
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate"
  );
}

/** The team's numbered announcement post, with an @channel ping. */
export function buildAnnouncementMessage(
  row: CandidateRow,
  resumeLink: string | null,
  profileUrl: string,
): string {
  const rec = row.person_recruiting;
  const position = (candidateJobLabel(rec) ?? "").trim().toUpperCase() || "IN-HOUSE";
  const fullNotes = (rec?.notes ?? rec?.status_notes ?? row.notes ?? "").trim();
  // Website applicants' notes carry the whole cover letter; keep the post short.
  const notes = fullNotes.length > 300 ? `${fullNotes.slice(0, 300).trimEnd()}…` : fullNotes;
  const phone = row.phone_mobile ?? row.phone_home ?? row.phone_other;
  const links = [
    resumeLink ? `<${resumeLink}|Resume>` : null,
    `<${profileUrl}|Open in GreenDogOps>`,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `<!channel> ✅ *NEW (${esc(position)}) CANDIDATE ANNOUNCEMENT*`,
    `1. NOTES: ${notes ? esc(notes) : "—"}`,
    `2. NAME: ${esc(candidateName(row))}`,
    `3. PHONE: ${phone ? esc(phone) : "—"}`,
    `4. EMAIL: ${row.email ? esc(row.email) : "—"}`,
    `5. LOCATION: ${rec?.candidate_location ? esc(rec.candidate_location) : "—"}`,
    `6. RESUME & INT LINK: ${links}`,
  ].join("\n");
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
