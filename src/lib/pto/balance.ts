// PTO self-service rules (go-live items 23–24, plan §H, D8, D8c). Pure, so the
// request form, the approver queue and the tests share one definition.
//
// Units are days. A planned day off is a whole day; when PTO is used as sick
// leave California allows blocks as small as 2 hours (Labor Code §246(k)),
// stored as a fraction of an 8-hour day. The request never asks for a reason.

import { addDays, isIsoDate } from "../worklist/dates";

export const PTO_DAY_HOURS = 8;
export const MIN_PARTIAL_HOURS = 2;
/** Furthest back a request may start: sick time is often reported afterwards. */
export const PTO_BACKDATE_DAYS = 30;
export const PTO_MAX_AHEAD_DAYS = 400;
export const PTO_MAX_RANGE_DAYS = 62;

export type TimeOffKind = "pto" | "vacation" | "time_off";

/** Kinds that use PTO days. `time_off` is unpaid. */
export const PAID_KINDS: readonly string[] = ["pto", "vacation"];

export function rangeDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Days a request would use as paid PTO (NULL pto_days = every day in the range). */
export function requestedDays(r: { pto_days: number | string | null; start_date: string; end_date: string }): number {
  return r.pto_days === null || r.pto_days === "" ? rangeDays(r.start_date, r.end_date) : Number(r.pto_days);
}

/**
 * Days a request holds against the balance — the same rule as the
 * person_time_off_balance trigger (0246).
 */
export function deductionDays(r: {
  kind: string;
  status: string;
  balance_tracked: boolean;
  pto_days: number | string | null;
  start_date: string;
  end_date: string;
}): number {
  if (r.status !== "approved" || !r.balance_tracked || !PAID_KINDS.includes(r.kind)) return 0;
  return requestedDays(r);
}

/** "3 days", "1 day", "2 h" (a partial day). */
export function formatDays(days: number): string {
  const d = Math.round(days * 100) / 100;
  if (d > 0 && d < 1) return `${Math.round(d * PTO_DAY_HOURS * 100) / 100} h`;
  return `${d} day${d === 1 ? "" : "s"}`;
}

export interface SelfRequestInput {
  start: string;
  end?: string | null;
  /** "full" (whole days) or "partial" (hours on one day). */
  mode: string;
  days?: string | number | null;
  hours?: string | number | null;
  note?: string | null;
}

export type SelfRequest = { start: string; end: string; ptoDays: number; note: string | null };

/** Validate an employee's own request. Never asks for a reason. */
export function parseSelfRequest(
  input: SelfRequestInput,
  today: string,
): { ok: true; value: SelfRequest } | { ok: false; error: string } {
  const start = String(input.start ?? "");
  const end = input.mode === "partial" ? start : String(input.end || start);
  if (!isIsoDate(start) || !isIsoDate(end)) return { ok: false, error: "Pick the dates." };
  if (end < start) return { ok: false, error: "The last day can't be before the first day." };
  if (start < addDays(today, -PTO_BACKDATE_DAYS)) {
    return { ok: false, error: `Requests can start at most ${PTO_BACKDATE_DAYS} days ago. Ask HR for anything older.` };
  }
  if (end > addDays(today, PTO_MAX_AHEAD_DAYS)) return { ok: false, error: "That date is too far ahead." };
  const span = rangeDays(start, end);
  if (span > PTO_MAX_RANGE_DAYS) return { ok: false, error: `One request can cover at most ${PTO_MAX_RANGE_DAYS} days.` };
  const note = String(input.note ?? "").trim().slice(0, 500) || null;

  if (input.mode === "partial") {
    const h = Number(input.hours);
    if (!Number.isFinite(h) || h < MIN_PARTIAL_HOURS || h > PTO_DAY_HOURS) {
      return { ok: false, error: `A partial day is ${MIN_PARTIAL_HOURS}–${PTO_DAY_HOURS} hours.` };
    }
    if (Math.round(h * 4) !== h * 4) return { ok: false, error: "Use quarter hours (e.g. 2, 2.5, 3.25)." };
    return { ok: true, value: { start, end, ptoDays: Math.round((h / PTO_DAY_HOURS) * 100) / 100, note } };
  }
  if (input.mode !== "full") return { ok: false, error: "Choose full days or part of a day." };
  const raw = input.days === null || input.days === undefined || input.days === "" ? span : Number(input.days);
  if (!Number.isInteger(raw) || raw < 1) return { ok: false, error: "PTO days must be a whole number of at least 1." };
  if (raw > span) return { ok: false, error: `That range has only ${span} day${span === 1 ? "" : "s"}.` };
  return { ok: true, value: { start, end, ptoDays: raw, note } };
}

/** Do the two inclusive date ranges overlap? */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export interface ReviewInput {
  decision: string;
  kind: string;
  days?: string | number | null;
  note?: string | null;
}

export type Review = { status: "approved" | "denied"; kind: TimeOffKind; ptoDays: number | null; note: string | null };

/** Validate an approver's decision: paid PTO or unpaid, days (0 = don't deduct), note. */
export function parseReview(
  input: ReviewInput,
  range: { start_date: string; end_date: string },
): { ok: true; value: Review } | { ok: false; error: string } {
  if (input.decision !== "approved" && input.decision !== "denied") return { ok: false, error: "Approve or deny." };
  if (input.kind !== "pto" && input.kind !== "vacation" && input.kind !== "time_off") {
    return { ok: false, error: "Choose paid PTO or unpaid." };
  }
  const note = String(input.note ?? "").trim().slice(0, 1000) || null;
  let ptoDays: number | null = null;
  if (input.days !== null && input.days !== undefined && input.days !== "") {
    const d = Number(input.days);
    if (!Number.isFinite(d) || d < 0) return { ok: false, error: "PTO days can't be negative." };
    if (Math.abs(Math.round(d * 100) - d * 100) > 1e-9) return { ok: false, error: "Use at most two decimals for PTO days." };
    if (d > rangeDays(range.start_date, range.end_date)) return { ok: false, error: "More PTO days than the request covers." };
    ptoDays = d;
  }
  return { ok: true, value: { status: input.decision, kind: input.kind, ptoDays, note } };
}

/**
 * The PTO balance fields an HR profile save may write: only the ones HR
 * actually changed (value differs from what the form loaded). The balance is
 * kept current by approvals (0246), so re-saving an untouched — possibly
 * stale — form must never overwrite it.
 */
export function ptoBalancePatch(
  get: (key: string) => FormDataEntryValue | null,
): { pto_used?: number | null; pto_available?: number | null } {
  const patch: { pto_used?: number | null; pto_available?: number | null } = {};
  for (const key of ["pto_used", "pto_available"] as const) {
    const raw = get(key);
    const was = get(`${key}_was`);
    if (raw === null || was === null) continue;
    const value = String(raw).trim() === "" ? null : Number(raw);
    const before = String(was).trim() === "" ? null : Number(was);
    if (value !== null && !Number.isFinite(value)) continue;
    if (value !== before) patch[key] = value;
  }
  return patch;
}
