import "server-only";

// ---------------------------------------------------------------------------
// Automated Slack posts for the recruiting channel.
//
// Early recruiting (applications, approvals, forms, phone screens) stays in
// Ops. A candidate's first Slack post is made when an in-person interview or
// shadow is scheduled (./slack-announce.ts); afterwards every update replies
// in that one thread. Updates for candidates who were never announced are not
// posted at all.
//
// Kept separate from ./slack-summary.ts, which the client-side copy button
// imports.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { postSlackMessage, isSlackConfigured } from "@/lib/slack/client";
import { recordAudit } from "@/lib/auth/session";
import type { CandidateRow } from "./types";
import { appBaseUrl } from "@/lib/shared/app-url";

export { appBaseUrl };

export { buildInterviewScheduledMessage, buildStageChangeMessage } from "./slack-messages";

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

/**
 * Reply in a candidate's Slack thread. Does nothing until they've been
 * announced, so early recruiting stays quiet. Best-effort: never throws.
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
    if (!threadTs) return;

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
        summary: "Posted candidate update to Slack thread",
        metadata: { channel: result.channel, ts: result.ts, thread_ts: threadTs ?? null },
      });
    }
  } catch (err) {
    console.error("[ats] Slack notify failed:", err);
  }
}
