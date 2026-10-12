"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminView, recordAudit } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { listSlackChannels } from "@/lib/slack/client";
import { getEventDefinition } from "@/lib/notify/registry";
import { ruleToRow, validateRuleInput } from "@/lib/notify/rule-config";
import { previewRoute, sendTestToSelf, type RoutePreview } from "@/lib/notify/admin";
import { dispatchPendingDeliveries } from "@/lib/notify/dispatch";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate() {
  revalidatePath("/admin/notifications");
}

export async function saveNotificationRule(type: string, input: unknown): Promise<ActionResult> {
  const current = await requireAdmin();
  const def = getEventDefinition(type);
  if (!def) return { ok: false, error: "Unknown notification." };
  const parsed = validateRuleInput(def, input);
  if (!parsed.ok) return parsed;
  const admin = createAdminClient();
  const { error } = await admin
    .from("notification_rule")
    .upsert(ruleToRow(type, parsed.rule, current.appUser.id), { onConflict: "event_type" });
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "notification_rule.update",
    entity: "notification_rule",
    entityId: type,
    summary: `Updated notification routing: ${def.label}`,
    metadata: { rule: parsed.rule },
  });
  revalidate();
  return { ok: true, message: "Saved." };
}

export async function resetNotificationRule(type: string): Promise<ActionResult> {
  const current = await requireAdmin();
  const def = getEventDefinition(type);
  if (!def) return { ok: false, error: "Unknown notification." };
  const admin = createAdminClient();
  const { error } = await admin.from("notification_rule").delete().eq("event_type", type);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "notification_rule.reset",
    entity: "notification_rule",
    entityId: type,
    summary: `Reset notification routing to default: ${def.label}`,
  });
  revalidate();
  return { ok: true, message: "Back to the default." };
}

export async function previewNotificationRule(
  type: string,
  input: unknown,
): Promise<{ ok: true; preview: RoutePreview } | { ok: false; error: string }> {
  await requireAdminView();
  const def = getEventDefinition(type);
  if (!def) return { ok: false, error: "Unknown notification." };
  const parsed = validateRuleInput(def, { ...((input as object) ?? {}), enabled: true });
  if (!parsed.ok) return parsed;
  return { ok: true, preview: await previewRoute(type, parsed.rule) };
}

export async function sendTestNotification(type: string): Promise<ActionResult> {
  const current = await requireAdmin();
  const res = await sendTestToSelf(type, current.appUser.person_id);
  return res.ok ? { ok: true, message: "Sent — check your Slack DMs." } : res;
}

export async function loadSlackChannelOptions(): Promise<
  | { ok: true; channels: { id: string; name: string; isPrivate: boolean; isMember: boolean }[] }
  | { ok: false; error: string }
> {
  await requireAdmin();
  return listSlackChannels();
}

/**
 * Re-queue a failed delivery. A failure after a timeout may already have
 * reached Slack, so this is an explicit admin decision, never automatic.
 */
export async function retryDelivery(id: string): Promise<ActionResult> {
  const current = await requireAdmin();
  if (!UUID.test(id)) return { ok: false, error: "Invalid delivery." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_delivery")
    .update({ status: "pending", next_attempt_at: new Date().toISOString(), last_error: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only failed deliveries can be retried." };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "notification_delivery.retry",
    entity: "notification_delivery",
    entityId: id,
    summary: "Retried a failed Slack notification",
  });
  const res = await dispatchPendingDeliveries({ trigger: "manual", triggeredBy: current.authId, deliveryIds: [id] });
  revalidate();
  if (!res.ok) return { ok: false, error: res.error ?? "Dispatch failed." };
  const c = res.counts;
  return {
    ok: true,
    message: c.sent ? "Sent." : c.skipped ? "Skipped — see the reason in the log." : c.failed ? "Failed again." : "Queued.",
  };
}

/** Run the dispatcher now (Admin ▸ Notifications ▸ "Process queue"). */
export async function runDispatchNow(): Promise<ActionResult> {
  const current = await requireAdmin();
  const res = await dispatchPendingDeliveries({ trigger: "manual", triggeredBy: current.authId });
  revalidate();
  if (!res.ok) return { ok: false, error: res.error ?? "Dispatch failed." };
  const c = res.counts;
  return { ok: true, message: `${c.sent} sent, ${c.skipped} skipped, ${c.failed} failed, ${c.retrying} retrying.` };
}
