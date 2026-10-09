"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, recordAudit } from "@/lib/auth/session";
import {
  disconnectPersonSlack,
  linkPersonToSlackUser,
  retrySlackMatch,
  runSlackUserSync,
  searchSlackAccounts,
} from "@/lib/slack/link-sync";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface SlackAccountOption {
  id: string;
  name: string;
  handle: string | null;
  email: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate(personId?: string) {
  revalidatePath("/admin/slack");
  if (personId) revalidatePath(`/hr/${personId}`);
}

/** Admin ▸ Slack ▸ "Sync now": match everyone in scope by email. */
export async function syncSlackUsersNow(): Promise<ActionResult> {
  const current = await requireAdmin();
  const result = await runSlackUserSync({
    trigger: "manual",
    triggeredBy: current.authId,
    triggeredByEmail: current.email,
  });
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "slack.sync",
    entity: "person_slack_link",
    summary: result.ok ? "Ran the Slack user sync" : "Slack user sync failed",
    metadata: { counts: result.counts, error: result.error ?? null, runId: result.runId },
  });
  revalidate();
  if (!result.ok) return { ok: false, error: result.error ?? "Slack sync failed." };
  const c = result.counts;
  return {
    ok: true,
    message: `${c.connected} connected (${c.newlyConnected} new), ${c.notFound + c.ambiguous + c.inactive} need attention.`,
  };
}

/** Re-match one person by email, even if an admin had disconnected them. */
export async function retrySlackLink(personId: string): Promise<ActionResult> {
  const current = await requireAdmin();
  if (!UUID.test(personId)) return { ok: false, error: "Invalid person." };
  const result = await retrySlackMatch(personId, current.authId, current.email);
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "slack.link_retry",
    entity: "person",
    entityId: personId,
    summary: "Retried the Slack email match",
    metadata: { counts: result.counts, error: result.error ?? null },
  });
  revalidate(personId);
  if (!result.ok) return { ok: false, error: result.error ?? "Slack match failed." };
  if (result.counts.scanned === 0) {
    return { ok: false, error: "Only active employees and contractors can be linked." };
  }
  return result.counts.connected
    ? { ok: true, message: "Connected." }
    : { ok: false, error: "Still no single Slack account with this person's email. Pick one manually." };
}

/** Link a person to a Slack account an admin picked. */
export async function linkSlackAccount(
  personId: string,
  slackUserId: string,
): Promise<ActionResult> {
  const current = await requireAdmin();
  if (!UUID.test(personId)) return { ok: false, error: "Invalid person." };
  const result = await linkPersonToSlackUser(personId, slackUserId, current.authId);
  if (!result.ok) return result;
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "slack.link_manual",
    entity: "person",
    entityId: personId,
    summary: "Linked a Slack account manually",
    metadata: { slack_user_id: slackUserId },
  });
  revalidate(personId);
  return { ok: true, message: "Connected." };
}

/** Unlink a person. Keeps the Slack id for audit; the sync won't re-link it. */
export async function disconnectSlackLink(personId: string): Promise<ActionResult> {
  const current = await requireAdmin();
  if (!UUID.test(personId)) return { ok: false, error: "Invalid person." };
  const result = await disconnectPersonSlack(personId);
  if (!result.ok) return result;
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "slack.disconnect",
    entity: "person",
    entityId: personId,
    summary: "Disconnected a Slack account",
  });
  revalidate(personId);
  return { ok: true, message: "Disconnected." };
}

/** Slack accounts for the manual-link picker. */
export async function searchSlackUsers(
  query: string,
): Promise<{ ok: true; options: SlackAccountOption[] } | { ok: false; error: string }> {
  await requireAdmin();
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return { ok: true, options: [] };
  try {
    const members = await searchSlackAccounts(q);
    return {
      ok: true,
      options: members.map((m) => ({
        id: m.id,
        name: m.realName || m.displayName || m.username || m.id,
        handle: m.displayName || m.username,
        email: m.email,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
