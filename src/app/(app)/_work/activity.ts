import "server-only";

// The signed-in user's own audit-log entries (matched by actor_email), grouped
// by day. Each entry maps to a module and is only shown if the user can access
// that module.

import type { ModuleKey } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODULE_HREFS, MODULE_ICONS, MODULE_LABELS } from "@/lib/shared/module-icons";
import type { ActivityDay, ActivityItem } from "../_components/activity-log";

const TZ = "America/Los_Angeles";

/** Map an audit entry to the module it belongs to (for access filtering). */
export function moduleForActivity(action: string, entity: string | null): ModuleKey {
  const a = action.toLowerCase();
  const e = (entity ?? "").toLowerCase();

  if (a.startsWith("task.")) return "dashboard";
  if (a.startsWith("referral.")) return "crm_referral";
  if (a.startsWith("influencer")) return "crm_influencer";
  if (a.startsWith("student")) return "crm_student";
  if (a.startsWith("ce.")) return "crm_ce";
  if (a.startsWith("vendor")) return "crm_vendor";
  if (a.startsWith("partner.")) return "crm_vendor";
  if (a.startsWith("resource.")) return "resources";
  if (a.startsWith("ats.")) return "ats";
  if (a.startsWith("hr.")) return "hr";
  if (a.startsWith("schedule.")) return "schedule";
  if (a.startsWith("planning.")) return "planning";
  if (
    a.startsWith("user.") ||
    a.startsWith("settings.") ||
    a.startsWith("credential.") ||
    a.startsWith("location.")
  ) {
    return "admin";
  }

  switch (e) {
    case "referral_partner":
      return "crm_referral";
    case "influencer":
      return "crm_influencer";
    case "resource_category":
    case "resource_document":
      return "resources";
    case "person":
      return "ats";
    case "contact":
      return "crm_student";
    default:
      return "admin";
  }
}

function prettifyAction(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(key: string, todayKey: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (key === todayKey) {
    return `Today · ${date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;
  }
  const base = date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${base}, ${y}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

export async function buildActivityDays(
  isVisible: (module: ModuleKey) => boolean,
  actorEmail: string | null,
): Promise<ActivityDay[]> {
  if (!actorEmail) return [];

  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("audit_log")
    .select("id, action, entity, summary, actor_email, created_at")
    .gte("created_at", since)
    .ilike("actor_email", actorEmail.replace(/[\\%_]/g, (c) => `\\${c}`))
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as {
    id: string;
    action: string;
    entity: string | null;
    summary: string | null;
    actor_email: string | null;
    created_at: string;
  }[];

  const todayKey = dayKey(new Date().toISOString());
  const byDay = new Map<string, ActivityItem[]>();
  byDay.set(todayKey, []);

  for (const r of rows) {
    const moduleKey = moduleForActivity(r.action, r.entity);
    if (!isVisible(moduleKey)) continue;
    const item: ActivityItem = {
      id: r.id,
      time: timeLabel(r.created_at),
      actor: r.actor_email ?? "system",
      moduleLabel: MODULE_LABELS[moduleKey] ?? moduleKey,
      moduleIcon: MODULE_ICONS[moduleKey] ?? "•",
      moduleHref: MODULE_HREFS[moduleKey] ?? "/",
      summary: r.summary?.trim() || prettifyAction(r.action),
    };
    const key = dayKey(r.created_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({ key, label: dayLabel(key, todayKey), items }));
}
