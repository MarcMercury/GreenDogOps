import "server-only";

// Data + operations behind Admin ▸ Notifications.

import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";
import { sendSlackDirectMessage } from "@/lib/slack/client";
import { appBaseUrl } from "@/lib/shared/app-url";
import { resolveAudience } from "./audience";
import { loadDirectory } from "./directory";
import { actionsFor } from "./plan";
import { EVENT_REGISTRY, getEventDefinition } from "./registry";
import { effectiveRule, type NotificationRuleRow } from "./rule-config";
import { SAMPLE_PAYLOADS } from "./samples";
import { buildCardBlocks, fallbackText } from "./slack-blocks";
import type { RuleConfig } from "./types";

export interface AdminRuleView {
  type: string;
  group: string;
  label: string;
  description: string;
  module: string;
  sensitivity: string;
  direct: boolean;
  allowChannel: boolean;
  escalatable: boolean;
  actions: string[];
  rule: RuleConfig;
  defaults: RuleConfig;
  overridden: boolean;
  updatedAt: string | null;
}

export interface AdminDeliveryView {
  id: string;
  createdAt: string;
  sentAt: string | null;
  eventType: string | null;
  channel: string;
  recipient: string;
  title: string;
  status: string;
  attempts: number;
  lastError: string | null;
  reason: string | null;
  batched: boolean;
  resolvedNote: string | null;
  acknowledgedAt: string | null;
}

export interface AdminActionView {
  id: string;
  createdAt: string;
  action: string;
  outcome: string;
  detail: string | null;
  actor: string;
}

export interface NotificationAdminData {
  rules: AdminRuleView[];
  deliveries: AdminDeliveryView[];
  actions: AdminActionView[];
  stats: { sent: number; failed: number; skipped: number; pending: number; events: number; failedEvents: number };
  people: { id: string; name: string; hasSlack: boolean; hasLogin: boolean }[];
  departments: { id: string; name: string }[];
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function loadNotificationAdmin(): Promise<NotificationAdminData> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [ruleRows, deliveries, actions, recent, events, depts, directory] = await Promise.all([
    admin.from("notification_rule").select("*"),
    admin
      .from("notification_delivery")
      .select(
        "id, created_at, sent_at, event_type, channel, title, status, attempts, last_error, audience_reason, batched, resolved_note, acknowledged_at, slack_channel_id, person:recipient_person_id (full_name, first_name, last_name, preferred_name), notification:notification_id (kind, title)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("notification_action")
      .select("id, created_at, action, outcome, detail, slack_user_id, actor:actor_user_id (full_name, email)")
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("notification_delivery").select("status").gte("created_at", since).limit(10000),
    admin.from("notification_event").select("status").gte("created_at", since).limit(10000),
    admin.from("sched_department").select("id, name").eq("is_active", true).order("sort_order"),
    loadDirectory(),
  ]);

  const rowsByType = new Map(((ruleRows.data ?? []) as NotificationRuleRow[]).map((r) => [r.event_type, r]));
  const rules: AdminRuleView[] = [...EVENT_REGISTRY.values()].map((def) => {
    const row = rowsByType.get(def.type) ?? null;
    return {
      type: def.type,
      group: def.group,
      label: def.label,
      description: def.description,
      module: def.module,
      sensitivity: def.sensitivity,
      direct: !!def.direct,
      allowChannel: def.allowChannel,
      escalatable: !!def.escalatable,
      actions: def.actions ?? [],
      rule: effectiveRule(def, row),
      defaults: def.defaults,
      overridden: !!row,
      updatedAt: row?.updated_at ?? null,
    };
  });

  type DRow = {
    id: string;
    created_at: string;
    sent_at: string | null;
    event_type: string | null;
    channel: string;
    title: string | null;
    status: string;
    attempts: number;
    last_error: string | null;
    audience_reason: string | null;
    batched: boolean;
    resolved_note: string | null;
    acknowledged_at: string | null;
    slack_channel_id: string | null;
    person: { full_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
    notification: { kind: string; title: string } | null;
  };
  const deliveryViews: AdminDeliveryView[] = ((deliveries.data ?? []) as unknown as DRow[]).map((d) => {
    const p = one(d.person);
    const n = one(d.notification);
    const name = p
      ? [p.preferred_name?.trim() || p.first_name?.trim(), p.last_name?.trim()].filter(Boolean).join(" ") || p.full_name || "—"
      : null;
    return {
      id: d.id,
      createdAt: d.created_at,
      sentAt: d.sent_at,
      eventType: d.event_type ?? n?.kind ?? null,
      channel: d.channel,
      recipient: d.channel === "slack_channel" ? `#${d.slack_channel_id ?? "channel"}` : (name ?? "—"),
      title: d.title ?? n?.title ?? "—",
      status: d.status,
      attempts: d.attempts,
      lastError: d.last_error,
      reason: d.audience_reason,
      batched: d.batched,
      resolvedNote: d.resolved_note,
      acknowledgedAt: d.acknowledged_at,
    };
  });

  type ARow = {
    id: string;
    created_at: string;
    action: string;
    outcome: string;
    detail: string | null;
    slack_user_id: string;
    actor: { full_name: string | null; email: string } | null;
  };
  const actionViews: AdminActionView[] = ((actions.data ?? []) as unknown as ARow[]).map((a) => {
    const actor = one(a.actor);
    return {
      id: a.id,
      createdAt: a.created_at,
      action: a.action,
      outcome: a.outcome,
      detail: a.detail,
      actor: actor?.full_name?.trim() || actor?.email || `Slack ${a.slack_user_id}`,
    };
  });

  const count = (rows: { status: string }[] | null, s: string) => (rows ?? []).filter((r) => r.status === s).length;
  const recentRows = recent.data as { status: string }[] | null;
  const eventRows = events.data as { status: string }[] | null;

  return {
    rules,
    deliveries: deliveryViews,
    actions: actionViews,
    stats: {
      sent: count(recentRows, "sent"),
      failed: count(recentRows, "failed"),
      skipped: count(recentRows, "skipped"),
      pending: count(recentRows, "pending") + count(recentRows, "sending"),
      events: eventRows?.length ?? 0,
      failedEvents: count(eventRows, "failed"),
    },
    people: directory
      .map((p) => ({ id: p.personId, name: p.name, hasSlack: !!p.slackUserId, hasLogin: !!p.login }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    departments: (depts.data ?? []) as { id: string; name: string }[],
  };
}

export interface RoutePreview {
  recipients: { name: string; reasons: string[]; slack: boolean; inbox: boolean; canAct: boolean }[];
  excluded: { name: string; reason: string }[];
  notes: string[];
}

const REASON_LABEL = (r: string): string => {
  if (r.startsWith("role:")) return ROLE_LABELS[r.slice(5) as AppRole] ?? r.slice(5);
  if (r.startsWith("editor:")) return `Edits ${r.slice(7)}`;
  return { person: "Picked by name", department: "Department", subject: "Subject", candidate: "Eligible" }[r] ?? r;
};

/** Who a rule reaches today (fixed groups only — subjects/candidates depend on each event). */
export async function previewRoute(type: string, rule: RuleConfig): Promise<RoutePreview> {
  const def = getEventDefinition(type);
  if (!def) return { recipients: [], excluded: [], notes: ["Unknown notification."] };
  const directory = await loadDirectory();
  const { recipients, excluded } = resolveAudience({
    audience: { ...rule.audience, subjects: false, candidates: false, sameLocation: false, excludeActor: false },
    sensitivity: def.sensitivity,
    module: def.module,
    actionModule: def.actionModule ?? null,
    event: { subjectPersonIds: [] },
    directory,
  });
  const byId = new Map(directory.map((p) => [p.personId, p]));
  const notes: string[] = [];
  if (rule.audience.subjects) notes.push("Plus the people each event is about (e.g. the employee whose shift changed).");
  if (rule.audience.candidates) notes.push("Plus eligible staff for each open shift (same scheduling role, free that day).");
  if (rule.audience.sameLocation) notes.push("Each event only reaches the people above at the event's location.");
  if (rule.channelId) notes.push(`Also posted to #${rule.channelName ?? rule.channelId}.`);
  if (!rule.enabled) notes.push("This notification is turned off.");
  return {
    recipients: recipients
      .map((r) => ({
        name: byId.get(r.personId)?.name ?? "—",
        reasons: r.reasons.map(REASON_LABEL),
        slack: rule.deliverDm && !!r.slackUserId,
        inbox: rule.deliverInbox && !!r.userId,
        canAct: r.canAct,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    excluded: excluded.map((e) => ({ name: e.name || "—", reason: e.reason })),
    notes,
  };
}

/** DM the admin a sample of one notification. Bypasses SLACK_DM_LIVE — only ever to themselves. */
export async function sendTestToSelf(type: string, personId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = getEventDefinition(type);
  if (!def?.render) return { ok: false, error: "This notification has no Slack template to test." };
  if (!personId) return { ok: false, error: "Your login isn't linked to an employee record." };
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("person_slack_link")
    .select("status, slack_user_id")
    .eq("person_id", personId)
    .maybeSingle();
  const l = link as { status: string; slack_user_id: string | null } | null;
  if (l?.status !== "connected" || !l.slack_user_id) {
    return { ok: false, error: "Your Slack account isn't connected (Admin ▸ Slack)." };
  }
  const payload = { ...(SAMPLE_PAYLOADS[type] ?? {}) };
  if (type === "schedule.published") payload.shifts = { [personId]: ["Mon, Oct 19 · 7a–5p · Venice · DVM"] };
  const msg = def.render(payload, { isSubject: true, personId, isChannel: false });
  const card = { msg: { ...msg, title: `[Test] ${msg.title}` }, actions: actionsFor(def, { isSubject: true, canAct: true }) };
  // A test card's buttons point at no delivery, so clicking them does nothing.
  const blocks = buildCardBlocks(card, { baseUrl: appBaseUrl(), deliveryId: "00000000-0000-0000-0000-000000000000", showActions: true });
  const res = await sendSlackDirectMessage(l.slack_user_id, fallbackText(card.msg), blocks);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
