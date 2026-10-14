"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { canApproveTime, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoDate, todayInWorkTz } from "@/lib/worklist/dates";
import { payPeriodFor } from "@/lib/timeclock/pay-period";
import { lockBlockers } from "@/lib/payroll/period";
import { ensurePayPeriod, loadPeriodReview, loadPeriodTimecards } from "@/lib/payroll/server";
import { freezeLines, isOverrideField, PAY_FIELD_LABELS, reviewBlockers, reviewTotals } from "@/lib/payroll/review";

// Payroll actions (checklist item 21, D9). Approvers: Owner, Admin, Executive,
// HR / Manager. Nobody approves their own timecard. Reopening a locked period
// is Owner/Admin only and needs a reason. Everything is audited.

export type PayrollResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = "/schedule/payroll";

async function gate(): Promise<{ ok: true; current: CurrentUser } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canApproveTime(current.appUser)) {
    return { ok: false, error: "Only Owners, Admins, Executives and HR / Managers can approve timecards." };
  }
  return { ok: true, current };
}

async function periodRow(periodStart: string) {
  if (!isIsoDate(periodStart)) return null;
  const p = payPeriodFor(periodStart);
  if (p.start !== periodStart) return null;
  return ensurePayPeriod(p);
}

export async function approveTimecard(periodStart: string, personId: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.test(personId)) return { ok: false, error: "Unknown employee." };
  if (g.current.appUser.person_id === personId) {
    return { ok: false, error: "You can't approve your own timecard. Ask another approver." };
  }
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is locked." };

  const row = (await loadPeriodTimecards(period)).find((r) => r.person_id === personId);
  if (!row) return { ok: false, error: "This employee has no time in the period." };
  if (row.blockers.length) return { ok: false, error: `Fix first: ${row.blockers.join("; ")}.` };

  const admin = createAdminClient();
  // Re-approving replaces the earlier sign-off (allowed while open).
  await admin.from("timecard_approval").delete().eq("pay_period_id", period.id).eq("person_id", personId);
  const { error } = await admin.from("timecard_approval").insert({
    pay_period_id: period.id,
    person_id: personId,
    approved_by: g.current.appUser.id,
    snapshot: row.snapshot,
  });
  if (error) return { ok: false, error: `Could not approve: ${error.message}` };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.timecard_approved",
    entity: "person",
    entityId: personId,
    summary: `Approved ${row.name}'s timecard for ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start, snapshot: row.snapshot },
  });
  revalidatePath(PAGE);
  return { ok: true, message: `Approved ${row.name}.` };
}

export async function unapproveTimecard(periodStart: string, personId: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.test(personId)) return { ok: false, error: "Unknown employee." };
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is locked." };
  const { data, error } = await createAdminClient()
    .from("timecard_approval")
    .delete()
    .eq("pay_period_id", period.id)
    .eq("person_id", personId)
    .select("id");
  if (error) return { ok: false, error: `Could not un-approve: ${error.message}` };
  if (!data?.length) return { ok: false, error: "That timecard isn't approved." };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.timecard_unapproved",
    entity: "person",
    entityId: personId,
    summary: `Un-approved a timecard for ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Approval removed." };
}

export async function lockPayPeriod(periodStart: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "open") return { ok: false, error: "This pay period is already locked." };
  const rows = await loadPeriodTimecards(period);
  const blockers = lockBlockers(rows, period.period_end, todayInWorkTz());
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  const { data, error } = await createAdminClient()
    .from("pay_period")
    .update({ status: "locked", locked_at: new Date().toISOString(), locked_by: g.current.appUser.id })
    .eq("id", period.id)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: `Could not lock: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Someone else changed this period. Refresh and try again." };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.period_locked",
    entity: "pay_period",
    entityId: period.id,
    summary: `Locked pay period ${period.period_start} – ${period.period_end} (${rows.length} timecards)`,
    metadata: { pay_period: period.period_start, timecards: rows.length },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Locked. Next: Payroll Review." };
}

export async function reopenPayPeriod(periodStart: string, reason: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isAdminRole(g.current.appUser.role)) return { ok: false, error: "Only Owners and Admins can reopen a locked period." };
  const why = (reason ?? "").trim().slice(0, 500);
  if (!why) return { ok: false, error: "Please give a reason for reopening." };
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status === "open") return { ok: false, error: "This period is already open." };
  const { error } = await createAdminClient()
    .from("pay_period")
    .update({
      status: "open",
      reopened_at: new Date().toISOString(),
      reopened_by: g.current.appUser.id,
      reopen_reason: why,
      review_snapshot: null,
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq("id", period.id);
  if (error) return { ok: false, error: `Could not reopen: ${error.message}` };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.period_reopened",
    entity: "pay_period",
    entityId: period.id,
    summary: `Reopened pay period ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start, previous_status: period.status, reason: why },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Reopened. Approvals stay; fix what's needed and lock again." };
}

// ---------------------------------------------------------------------------
// Payroll Review (between Lock and the ADP export). Overrides are append-only
// and only allowed while the period is locked (database guard, 0247).
// ---------------------------------------------------------------------------

export async function overridePayroll(
  periodStart: string,
  personId: string,
  field: string,
  hoursRaw: string,
  reason: string,
): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.test(personId)) return { ok: false, error: "Unknown employee." };
  if (!isOverrideField(field)) return { ok: false, error: "Unknown pay line." };
  if (g.current.appUser.person_id === personId) return { ok: false, error: "You can't change your own pay. Ask another approver." };
  const why = (reason ?? "").trim().slice(0, 1000);
  if (!why) return { ok: false, error: "Give a reason for the change." };
  let value: number | null = null;
  const raw = (hoursRaw ?? "").trim();
  if (raw !== "") {
    const n = Number(raw);
    if (field === "exclude" ? n !== 0 && n !== 1 : !Number.isFinite(n) || n < 0 || n > 400 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
      return { ok: false, error: "Enter hours between 0 and 400 with at most two decimals." };
    }
    value = n;
  }
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "locked") return { ok: false, error: "Changes are only possible while the period is locked for review." };

  const { error } = await createAdminClient().from("payroll_override").insert({
    pay_period_id: period.id,
    person_id: personId,
    field,
    hours: value,
    reason: why,
    created_by: g.current.appUser.id,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const what = field === "exclude" ? (value === 1 ? "left out of the export" : value === 0 ? "put back in the export" : "export inclusion reset") : `${PAY_FIELD_LABELS[field]} ${value === null ? "reset to calculated" : `set to ${value} h`}`;
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.override",
    entity: "person",
    entityId: personId,
    summary: `Payroll review ${period.period_start} – ${period.period_end}: ${what}`,
    metadata: { pay_period: period.period_start, field, hours: value, reason: why },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Saved." };
}

export async function completePayrollReview(periodStart: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "locked") return { ok: false, error: "Only a locked period can be reviewed." };
  const lines = await loadPeriodReview(period);
  const blockers = reviewBlockers(lines);
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  const frozen = freezeLines(lines);
  const { data, error } = await createAdminClient()
    .from("pay_period")
    .update({ status: "reviewed", review_snapshot: frozen, reviewed_at: new Date().toISOString(), reviewed_by: g.current.appUser.id })
    .eq("id", period.id)
    .eq("status", "locked")
    .select("id");
  if (error) return { ok: false, error: `Could not complete the review: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Someone else changed this period. Refresh and try again." };
  const totals = reviewTotals(frozen);
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.review_completed",
    entity: "pay_period",
    entityId: period.id,
    summary: `Completed payroll review ${period.period_start} – ${period.period_end} (${frozen.length} employees)`,
    metadata: { pay_period: period.period_start, totals },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Review complete. Next: export the ADP RUN file." };
}

/** Back from "reviewed" to "locked" to make more changes (not after export). */
export async function reopenPayrollReview(periodStart: string): Promise<PayrollResult> {
  const g = await gate();
  if (!g.ok) return g;
  const period = await periodRow(periodStart);
  if (!period) return { ok: false, error: "Unknown pay period." };
  if (period.status !== "reviewed") return { ok: false, error: "Only a reviewed (not yet exported) period can go back to review." };
  const { data, error } = await createAdminClient()
    .from("pay_period")
    .update({ status: "locked", review_snapshot: null, reviewed_at: null, reviewed_by: null })
    .eq("id", period.id)
    .eq("status", "reviewed")
    .select("id");
  if (error) return { ok: false, error: `Could not reopen the review: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Someone else changed this period. Refresh and try again." };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "payroll.review_reopened",
    entity: "pay_period",
    entityId: period.id,
    summary: `Reopened payroll review ${period.period_start} – ${period.period_end}`,
    metadata: { pay_period: period.period_start },
  });
  revalidatePath(PAGE);
  return { ok: true, message: "Back in review. Make your changes, then complete the review again." };
}
