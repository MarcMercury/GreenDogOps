import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { payPeriodFor, type PayPeriod } from "@/lib/timeclock/pay-period";
import { localToInstant } from "@/lib/timeclock/local-time";
import { waiverInForce, type WaiverRecord } from "@/lib/timeclock/meal-waiver";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";
import {
  buildSessions,
  effectivePunches,
  type PunchAdjustment,
  type PunchReview,
  type RawPunch,
} from "@/lib/timeclock/timecard";
import { approvalBlockers, computePeriod, type FlsaClass, type PeriodResult } from "./ca-rules";
import { approvalStale, snapshotOf, type ApprovalSnapshot } from "./period";

// Payroll period data (checklist item 21). Service role; callers must have
// checked canApproveTime (D9) — this is everyone's hours.

export type PeriodStatus = "open" | "locked" | "exported";

export interface PayPeriodRow {
  id: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: PeriodStatus;
  locked_at: string | null;
}

/** The pay_period row for a period, created on first use. */
export async function ensurePayPeriod(p: PayPeriod): Promise<PayPeriodRow> {
  const admin = createAdminClient();
  const cols = "id, period_start, period_end, pay_date, status, locked_at";
  const { data } = await admin.from("pay_period").select(cols).eq("period_start", p.start).maybeSingle();
  if (data) return data as PayPeriodRow;
  const { data: created, error } = await admin
    .from("pay_period")
    .upsert({ period_start: p.start, period_end: p.end, pay_date: p.payDate }, { onConflict: "period_start", ignoreDuplicates: true })
    .select(cols)
    .maybeSingle();
  if (created) return created as PayPeriodRow;
  const { data: again, error: e2 } = await admin.from("pay_period").select(cols).eq("period_start", p.start).single();
  if (!again) throw new Error(`Could not create the pay period: ${(error ?? e2)?.message ?? "unknown error"}`);
  return again as PayPeriodRow;
}

export interface EmployeePeriod {
  person_id: string;
  name: string;
  flsa: FlsaClass;
  adp_employee_id: string | null;
  result: PeriodResult;
  snapshot: ApprovalSnapshot;
  blockers: string[];
  approval: { approved_at: string; approved_by_name: string | null; stale: boolean } | null;
}

interface PersonRow {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

const nameOf = (p: PersonRow | undefined) =>
  p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || "Unknown" : "Unknown";

/** Every employee with time in the period, computed under the California rules. */
export async function loadPeriodTimecards(
  period: Pick<PayPeriodRow, "id" | "period_start" | "period_end">,
  now: Date = new Date(),
): Promise<EmployeePeriod[]> {
  const admin = createAdminClient();
  const { period_start: from, period_end: to } = period;

  const [punchRes, adjRes] = await Promise.all([
    fetchAllRows<RawPunch & { person_id: string }>((a, b) =>
      admin
        .from("time_punch")
        .select("id, person_id, punch_type, punched_at, work_date, location_id, rest_breaks_ok, location_check, needs_approval, assignment_id")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("id")
        .range(a, b),
    ),
    fetchAllRows<PunchAdjustment & { person_id: string }>((a, b) =>
      admin
        .from("time_punch_adjustment")
        .select("id, person_id, action, punch_type, punched_at, work_date, voids_punch_id, voids_adjustment_id, reason, created_at")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("id")
        .range(a, b),
    ),
  ]);
  if (punchRes.error) throw new Error(`Could not load punches: ${punchRes.error.message}`);
  if (adjRes.error) throw new Error(`Could not load timecard changes: ${adjRes.error.message}`);

  const personIds = [...new Set([...punchRes.data.map((p) => p.person_id), ...adjRes.data.map((a) => a.person_id)])];
  if (personIds.length === 0) return [];

  const pendingIds = punchRes.data.filter((p) => p.needs_approval).map((p) => p.id);
  const [people, emp, waivers, approvals, reviews] = await Promise.all([
    admin.from("person").select("id, full_name, first_name, last_name, preferred_name").in("id", personIds),
    admin.from("person_employment").select("person_id, flsa_status, adp_employee_id").in("person_id", personIds),
    admin.from("meal_waiver").select("person_id, kind, signed_at, revoked_at").in("person_id", personIds),
    admin.from("timecard_approval").select("person_id, approved_at, approved_by, snapshot").eq("pay_period_id", period.id),
    pendingIds.length
      ? admin.from("time_punch_review").select("punch_id, decision").in("punch_id", pendingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [people, emp, waivers, approvals, reviews]) {
    if (r.error) throw new Error(`Could not load payroll data: ${r.error.message}`);
  }

  const approverIds = [...new Set(((approvals.data ?? []) as { approved_by: string | null }[]).map((a) => a.approved_by).filter((v): v is string => !!v))];
  const approverNames = new Map<string, string>();
  if (approverIds.length) {
    const { data } = await admin.from("app_user").select("id, full_name, email").in("id", approverIds);
    for (const u of (data ?? []) as { id: string; full_name: string | null; email: string }[]) approverNames.set(u.id, u.full_name || u.email);
  }

  const personById = new Map(((people.data ?? []) as PersonRow[]).map((p) => [p.id, p]));
  const empById = new Map(
    ((emp.data ?? []) as { person_id: string; flsa_status: string | null; adp_employee_id: string | null }[]).map((e) => [e.person_id, e]),
  );
  const approvalById = new Map(
    ((approvals.data ?? []) as { person_id: string; approved_at: string; approved_by: string | null; snapshot: ApprovalSnapshot }[]).map((a) => [a.person_id, a]),
  );
  const waiverRows = (waivers.data ?? []) as (WaiverRecord & { person_id: string })[];
  const reviewRows = (reviews.data ?? []) as PunchReview[];

  return personIds
    .map((personId) => {
      const e = empById.get(personId);
      const flsa: FlsaClass = e?.flsa_status === "exempt" ? "exempt" : e?.flsa_status === "non_exempt" ? "non_exempt" : "unknown";
      const eff = effectivePunches(
        punchRes.data.filter((p) => p.person_id === personId),
        adjRes.data.filter((a) => a.person_id === personId),
        reviewRows,
      );
      const mine = waiverRows.filter((w) => w.person_id === personId);
      const result = computePeriod({
        sessions: buildSessions(eff, now),
        periodStart: from,
        periodEnd: to,
        flsa,
        waiversAt: (date, firstIn) => {
          const at = firstIn ? new Date(firstIn) : localToInstant(date, "12:00", TIME_CLOCK_TZ) ?? new Date(date);
          return { sixHour: waiverInForce(mine, "six_hour", at), secondMeal: waiverInForce(mine, "second_meal", at) };
        },
      });
      const snapshot = snapshotOf(flsa, e?.adp_employee_id ?? null, result.totals);
      const approval = approvalById.get(personId);
      return {
        person_id: personId,
        name: nameOf(personById.get(personId)),
        flsa,
        adp_employee_id: e?.adp_employee_id ?? null,
        result,
        snapshot,
        blockers: approvalBlockers(result),
        approval: approval
          ? {
              approved_at: approval.approved_at,
              approved_by_name: approval.approved_by ? approverNames.get(approval.approved_by) ?? null : null,
              stale: approvalStale(approval.snapshot, snapshot),
            }
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function periodFor(date: string): PayPeriod {
  return payPeriodFor(date);
}
