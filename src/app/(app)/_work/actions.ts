"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { isAdminRole, MODULES, APP_ROLES, type ModuleKey } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkbox,
  optionalDate,
  optionalEnum,
  optionalText,
  optionalUuid,
  parseForm,
  requiredText,
  z,
} from "@/lib/validation/form";
import { createOpsTask, setOpsTaskStatus } from "@/lib/worklist/tasks";
import { isSafeWorkLink, WORK_PRIORITIES, type WorkPriority } from "@/lib/worklist/items";
import {
  occursOn,
  reminderAppliesTo,
  REMINDER_CADENCES,
  scheduleError,
  type ReminderCadence,
  type ReminderRule,
} from "@/lib/worklist/reminders";
import { isIsoDate, todayInWorkTz } from "@/lib/worklist/dates";

export type WorkActionResult = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SIGNED_IN = { ok: false as const, error: "You are not signed in." };
const MODULE_KEYS = MODULES.map((m) => m.key) as [ModuleKey, ...ModuleKey[]];

function refresh() {
  revalidatePath("/");
  revalidatePath("/reminders");
  revalidatePath("/admin/reminders");
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  title: requiredText(200, "Title"),
  details: optionalText(4000),
  assignee_user_id: optionalUuid,
  due_date: optionalDate,
  priority: optionalEnum(WORK_PRIORITIES as unknown as [WorkPriority, ...WorkPriority[]]),
  link: optionalText(1000),
  notify_slack: checkbox,
});

export async function createTaskAction(formData: FormData): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const parsed = parseForm(taskSchema, formData);
  if (!parsed.ok) return parsed;
  const d = parsed.data;
  if (d.due_date && !isIsoDate(d.due_date)) return { ok: false, error: "Not a real date." };
  if (!isSafeWorkLink(d.link)) {
    return { ok: false, error: "Link must be an Ops path (like /schedule) or a Slack link." };
  }
  const result = await createOpsTask(current, {
    assigneeUserId: d.assignee_user_id ?? current.appUser.id,
    title: d.title,
    details: d.details,
    dueDate: d.due_date,
    priority: d.priority ?? "normal",
    href: d.link,
    notifySlack: d.notify_slack,
  });
  if (!result.ok) return result;
  refresh();
  return { ok: true, message: "Task added." };
}

export async function setTaskStatusAction(
  taskId: string,
  status: "open" | "done" | "dismissed",
): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  if (!UUID.test(taskId) || !["open", "done", "dismissed"].includes(status)) {
    return { ok: false, error: "Invalid task." };
  }
  const result = await setOpsTaskStatus(current, taskId, status);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function markNotificationsRead(ids: string[] | "all"): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  const admin = createAdminClient();
  let q = admin
    .from("user_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", current.appUser.id)
    .is("read_at", null);
  if (ids !== "all") {
    const valid = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 100);
    if (!valid.length) return { ok: true };
    q = q.in("id", valid);
  }
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function archiveNotification(id: string): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return { ok: false, error: "Invalid notification." };
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("user_notification")
    .select("read_at")
    .eq("id", id)
    .eq("recipient_user_id", current.appUser.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Notification not found." };
  const { error } = await admin
    .from("user_notification")
    .update({ archived_at: now, read_at: (row as { read_at: string | null }).read_at ?? now })
    .eq("id", id)
    .eq("recipient_user_id", current.appUser.id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reminder acknowledgements
// ---------------------------------------------------------------------------

async function loadRule(id: string): Promise<ReminderRule | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("reminder_rule").select("*").eq("id", id).maybeSingle();
  return (data as ReminderRule | null) ?? null;
}

export async function setReminderDone(
  ruleId: string,
  occurrenceDate: string,
  done: boolean,
): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  if (!UUID.test(ruleId) || !isIsoDate(occurrenceDate)) return { ok: false, error: "Invalid reminder." };
  const rule = await loadRule(ruleId);
  if (!rule || !reminderAppliesTo(rule, current.appUser)) return { ok: false, error: "Reminder not found." };
  if (occurrenceDate > todayInWorkTz() || !occursOn(rule, occurrenceDate)) {
    return { ok: false, error: "That reminder isn't due on that date." };
  }
  const admin = createAdminClient();
  const { error } = done
    ? await admin
        .from("reminder_ack")
        .upsert(
          { rule_id: ruleId, user_id: current.appUser.id, occurrence_date: occurrenceDate },
          { onConflict: "rule_id,user_id,occurrence_date", ignoreDuplicates: true },
        )
    : await admin
        .from("reminder_ack")
        .delete()
        .eq("rule_id", ruleId)
        .eq("user_id", current.appUser.id)
        .eq("occurrence_date", occurrenceDate);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reminder rules (personal: any user for themselves; shared: Owner/Admin)
// ---------------------------------------------------------------------------

const toList = (v: unknown) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const optionalSmallInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? null : v),
    z.coerce.number().int().min(min).max(max).nullable(),
  );

const ruleSchema = z.object({
  id: optionalUuid,
  title: requiredText(200, "Title"),
  details: optionalText(2000),
  link: optionalText(1000),
  module: optionalEnum(MODULE_KEYS),
  cadence: z.enum(REMINDER_CADENCES as unknown as [ReminderCadence, ...ReminderCadence[]]),
  weekdays: z.preprocess(toList, z.array(z.coerce.number().int().min(0).max(6)).max(7)),
  month_day: optionalSmallInt(-1, 31),
  week_of_month: optionalSmallInt(-1, 5),
  month: optionalSmallInt(1, 12),
  audience_roles: z.preprocess(toList, z.array(z.enum(APP_ROLES as unknown as [string, ...string[]])).max(7)),
  is_active: checkbox,
  starts_on: optionalDate,
  sort_order: optionalSmallInt(0, 10_000),
});

/** Keep only the fields the chosen cadence uses, so stale inputs don't trip the DB check. */
function scheduleFields(d: z.infer<typeof ruleSchema>) {
  const weekdays = [...new Set(d.weekdays)].sort((a, b) => a - b);
  switch (d.cadence) {
    case "weekly":
      return { weekdays, month_day: null, week_of_month: null, month: null };
    case "monthly_day":
    case "monthly_business_day":
      return { weekdays: [] as number[], month_day: d.month_day, week_of_month: null, month: null };
    case "monthly_weekday":
      return { weekdays, month_day: null, week_of_month: d.week_of_month, month: null };
    case "yearly":
      return { weekdays: [] as number[], month_day: d.month_day, week_of_month: null, month: d.month };
  }
}

async function saveRule(formData: FormData, shared: boolean): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  if (shared && !isAdminRole(current.appUser.role)) {
    return { ok: false, error: "Only Owners and Admins can manage shared reminders." };
  }
  const parsed = parseForm(ruleSchema, formData);
  if (!parsed.ok) return parsed;
  const d = parsed.data;
  const schedule = scheduleFields(d);
  const problem = scheduleError({ cadence: d.cadence, ...schedule });
  if (problem) return { ok: false, error: problem };
  if (d.month_day === 0 || d.week_of_month === 0) return { ok: false, error: "Pick a day." };
  if (!isSafeWorkLink(d.link)) return { ok: false, error: "Link must be an Ops path (like /schedule) or a Slack link." };

  const existing = d.id ? await loadRule(d.id) : null;
  if (d.id) {
    const allowed = shared ? existing?.owner_user_id === null : existing?.owner_user_id === current.appUser.id;
    if (!existing || !allowed) return { ok: false, error: "Reminder not found." };
  }

  const row = {
    title: d.title,
    details: d.details,
    href: d.link,
    module: shared ? d.module : null,
    cadence: d.cadence,
    ...schedule,
    audience_roles: shared ? d.audience_roles : [],
    owner_user_id: shared ? null : current.appUser.id,
    is_active: d.id ? d.is_active : true,
    sort_order: d.sort_order ?? existing?.sort_order ?? 100,
    ...(d.starts_on ? { starts_on: d.starts_on } : {}),
  };

  const admin = createAdminClient();
  const { data, error } = d.id
    ? await admin.from("reminder_rule").update(row).eq("id", d.id).select("id").single()
    : await admin
        .from("reminder_rule")
        .insert({ ...row, created_by_user_id: current.appUser.id })
        .select("id")
        .single();
  if (error) return { ok: false, error: error.message };

  if (shared) {
    await recordAudit({
      actorId: current.authId,
      actorEmail: current.email,
      action: d.id ? "settings.reminder_update" : "settings.reminder_create",
      entity: "reminder_rule",
      entityId: (data as { id: string }).id,
      summary: `${d.id ? "Updated" : "Created"} shared reminder "${d.title}"`,
    });
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function saveMyReminder(formData: FormData): Promise<WorkActionResult> {
  return saveRule(formData, false);
}

export async function saveSharedReminder(formData: FormData): Promise<WorkActionResult> {
  return saveRule(formData, true);
}

export async function deleteReminder(id: string): Promise<WorkActionResult> {
  const current = await getCurrentUser();
  if (!current) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return { ok: false, error: "Invalid reminder." };
  const rule = await loadRule(id);
  if (!rule) return { ok: false, error: "Reminder not found." };
  const shared = rule.owner_user_id === null;
  const allowed = shared ? isAdminRole(current.appUser.role) : rule.owner_user_id === current.appUser.id;
  if (!allowed) return { ok: false, error: "Reminder not found." };
  const admin = createAdminClient();
  const { error } = await admin.from("reminder_rule").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (shared) {
    await recordAudit({
      actorId: current.authId,
      actorEmail: current.email,
      action: "settings.reminder_delete",
      entity: "reminder_rule",
      entityId: id,
      summary: `Deleted shared reminder "${rule.title}"`,
    });
  }
  refresh();
  return { ok: true };
}
