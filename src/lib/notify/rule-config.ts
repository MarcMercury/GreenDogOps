// Rule config: merge admin overrides (notification_rule rows) with the code
// defaults, and validate what Admin ▸ Notifications submits. Pure.

import { APP_ROLES, MODULES, type AppRole, type ModuleKey } from "../auth/permissions";
import type { EventDefinition } from "./registry";
import { NOTIFY_PRIORITIES, type Audience, type NotifyPriority, type RuleConfig } from "./types";

export interface NotificationRuleRow {
  event_type: string;
  enabled: boolean;
  audience: unknown;
  deliver_dm: boolean;
  deliver_inbox: boolean;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  priority: string;
  batch_minutes: number;
  escalate_after_hours: number | null;
  escalate_roles: string[] | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_ID = /^[CG][A-Z0-9]+$/;
const MODULE_KEYS = new Set<string>(MODULES.map((m) => m.key));
const ROLE_SET = new Set<string>(APP_ROLES);

function roles(v: unknown): AppRole[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((r): r is AppRole => typeof r === "string" && ROLE_SET.has(r)))]
    : [];
}

function modules(v: unknown): ModuleKey[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((m): m is ModuleKey => typeof m === "string" && MODULE_KEYS.has(m)))]
    : [];
}

function uuids(v: unknown, max = 200): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, max)
    : [];
}

/** Drop anything unknown from a stored/submitted audience. */
export function sanitizeAudience(raw: unknown, fallback: Audience): Audience {
  if (!raw || typeof raw !== "object") return fallback;
  const a = raw as Record<string, unknown>;
  const bool = (k: string, d: boolean) => (typeof a[k] === "boolean" ? (a[k] as boolean) : d);
  return {
    subjects: bool("subjects", fallback.subjects),
    roles: "roles" in a ? roles(a.roles) : fallback.roles,
    editorsOf: "editorsOf" in a ? modules(a.editorsOf) : fallback.editorsOf,
    personIds: "personIds" in a ? uuids(a.personIds) : fallback.personIds,
    departmentIds: "departmentIds" in a ? uuids(a.departmentIds) : fallback.departmentIds,
    candidates: bool("candidates", fallback.candidates),
    sameLocation: bool("sameLocation", fallback.sameLocation),
    excludeActor: bool("excludeActor", fallback.excludeActor),
  };
}

function priority(v: unknown, d: NotifyPriority): NotifyPriority {
  return NOTIFY_PRIORITIES.includes(v as NotifyPriority) ? (v as NotifyPriority) : d;
}

/** Effective rule for an event type: the admin override when there is one. */
export function effectiveRule(def: EventDefinition, row: NotificationRuleRow | null): RuleConfig {
  const d = def.defaults;
  if (!row) return d;
  const channelOk = def.allowChannel && row.slack_channel_id && CHANNEL_ID.test(row.slack_channel_id);
  return {
    enabled: row.enabled,
    // Direct events address one recipient chosen by the caller.
    audience: def.direct ? d.audience : sanitizeAudience(row.audience, d.audience),
    deliverDm: row.deliver_dm,
    deliverInbox: row.deliver_inbox,
    channelId: channelOk ? row.slack_channel_id : null,
    channelName: channelOk ? row.slack_channel_name : null,
    priority: priority(row.priority, d.priority),
    batchMinutes: Math.min(1440, Math.max(0, Math.round(row.batch_minutes || 0))),
    escalateAfterHours: def.escalatable ? row.escalate_after_hours : null,
    escalateRoles: def.escalatable ? roles(row.escalate_roles) : [],
  };
}

export type RuleInputResult = { ok: true; rule: RuleConfig } | { ok: false; error: string };

/** Validate a rule submitted from Admin ▸ Notifications. */
export function validateRuleInput(def: EventDefinition, input: unknown): RuleInputResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid rule." };
  const r = input as Record<string, unknown>;
  const d = def.defaults;
  const aud = def.direct ? d.audience : sanitizeAudience(r.audience, d.audience);

  const channelId = typeof r.channelId === "string" && r.channelId.trim() ? r.channelId.trim() : null;
  if (channelId && !def.allowChannel) return { ok: false, error: "This notification can't be posted to a channel." };
  if (channelId && !CHANNEL_ID.test(channelId)) return { ok: false, error: "Pick a Slack channel from the list." };

  const batch = Number(r.batchMinutes ?? 0);
  if (!Number.isInteger(batch) || batch < 0 || batch > 1440) {
    return { ok: false, error: "Batching must be 0–1440 minutes." };
  }

  let escalateAfterHours: number | null = null;
  let escalateRoles: AppRole[] = [];
  if (def.escalatable && r.escalateAfterHours !== null && r.escalateAfterHours !== undefined && r.escalateAfterHours !== "") {
    const h = Number(r.escalateAfterHours);
    if (!Number.isInteger(h) || h < 1 || h > 720) return { ok: false, error: "Escalate after 1–720 hours." };
    escalateRoles = roles(r.escalateRoles);
    if (escalateRoles.length === 0) return { ok: false, error: "Choose who receives the escalation." };
    escalateAfterHours = h;
  }

  const deliverDm = r.deliverDm !== false;
  const deliverInbox = r.deliverInbox !== false;
  const enabled = r.enabled !== false;
  if (enabled && !deliverDm && !deliverInbox && !channelId) {
    return { ok: false, error: "Turn on at least one of Slack DM, in-app inbox or a channel — or disable the notification." };
  }
  const hasAudience =
    aud.subjects || aud.roles.length || aud.editorsOf.length || aud.personIds.length ||
    aud.departmentIds.length || aud.candidates;
  if (enabled && !hasAudience && !channelId) {
    return { ok: false, error: "Choose at least one recipient group or a channel." };
  }

  return {
    ok: true,
    rule: {
      enabled,
      audience: aud,
      deliverDm,
      deliverInbox,
      channelId,
      channelName:
        channelId && typeof r.channelName === "string" ? r.channelName.trim().slice(0, 100) || null : null,
      priority: priority(r.priority, d.priority),
      batchMinutes: batch,
      escalateAfterHours,
      escalateRoles,
    },
  };
}

export function ruleToRow(type: string, rule: RuleConfig, updatedBy: string | null) {
  return {
    event_type: type,
    enabled: rule.enabled,
    audience: rule.audience,
    deliver_dm: rule.deliverDm,
    deliver_inbox: rule.deliverInbox,
    slack_channel_id: rule.channelId,
    slack_channel_name: rule.channelName,
    priority: rule.priority,
    batch_minutes: rule.batchMinutes,
    escalate_after_hours: rule.escalateAfterHours,
    escalate_roles: rule.escalateRoles,
    updated_by: updatedBy,
  };
}

/** Human summary of an audience, for the admin table. */
export function describeAudience(a: Audience, labels: {
  role: (r: AppRole) => string;
  module: (m: ModuleKey) => string;
  department: (id: string) => string;
}): string {
  const parts: string[] = [];
  if (a.subjects) parts.push("People it's about");
  if (a.candidates) parts.push("Eligible staff");
  if (a.roles.length) parts.push(a.roles.map(labels.role).join(", "));
  if (a.editorsOf.length) parts.push(`Editors of ${a.editorsOf.map(labels.module).join(", ")}`);
  if (a.departmentIds.length) parts.push(`Dept: ${a.departmentIds.map(labels.department).join(", ")}`);
  if (a.personIds.length) parts.push(`${a.personIds.length} specific ${a.personIds.length === 1 ? "person" : "people"}`);
  let out = parts.join(" · ") || "Nobody";
  if (a.sameLocation) out += " (same location)";
  return out;
}
