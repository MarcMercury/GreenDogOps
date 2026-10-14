// Payroll Review (after Lock, before the ADP export) — pure.
//
// Each employee's pay line for a locked period starts from what was approved
// (the timecard snapshot) plus approved paid PTO in the period, then HR can
// override any hour bucket, or leave the employee out of the file, with a
// reason. Overrides are append-only; the latest one per employee and bucket
// wins and a null value clears it. "Complete review" freezes the lines; the
// export is built only from that frozen copy.

import { hours } from "./ca-rules";
import type { ApprovalSnapshot } from "./period";
import { PAID_KINDS, PTO_DAY_HOURS, rangeDays } from "../pto/balance";

export const PAY_FIELDS = ["regular", "overtime", "double_time", "meal_premium", "pto"] as const;
export type PayField = (typeof PAY_FIELDS)[number];

export const PAY_FIELD_LABELS: Record<PayField, string> = {
  regular: "Regular",
  overtime: "Overtime 1.5x",
  double_time: "Double time 2x",
  meal_premium: "Meal premium",
  pto: "PTO",
};

/** Override target: an hour bucket, or "exclude" (1 = leave out of the export, 0 = include). */
export type OverrideField = PayField | "exclude";
export const OVERRIDE_FIELDS: readonly OverrideField[] = [...PAY_FIELDS, "exclude"];

export function isOverrideField(v: unknown): v is OverrideField {
  return typeof v === "string" && (OVERRIDE_FIELDS as readonly string[]).includes(v);
}

export type PayHours = Record<PayField, number>;

export interface PayLine {
  person_id: string;
  name: string;
  adp_employee_id: string | null;
  flsa: "exempt" | "non_exempt" | "unknown";
  hours: PayHours;
  /** What Ops calculated before any override, for the "was" column. */
  calculated: PayHours;
  overridden: PayField[];
  excluded: boolean;
  /** Reasons given for the overrides in force, newest first. */
  reasons: string[];
}

export interface OverrideRow {
  person_id: string;
  field: string;
  hours: number | string | null;
  reason: string;
  created_at: string;
}

export interface PtoRequestRow {
  person_id: string;
  kind: string;
  status: string;
  start_date: string;
  end_date: string;
  pto_days: number | string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function zeroHours(): PayHours {
  return { regular: 0, overtime: 0, double_time: 0, meal_premium: 0, pto: 0 };
}

/**
 * Paid PTO hours inside [periodStart, periodEnd] for one person, in whole
 * 8-hour days. A request that straddles the period counts only its days inside
 * it; a request using fewer PTO days than its calendar range is spread as
 * evenly as whole days allow (cumulative rounding), so each period gets whole
 * days and the periods always add up to the request.
 */
export function ptoHoursInPeriod(rows: readonly PtoRequestRow[], periodStart: string, periodEnd: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.status !== "approved" || !PAID_KINDS.includes(r.kind)) continue;
    const from = r.start_date > periodStart ? r.start_date : periodStart;
    const to = r.end_date < periodEnd ? r.end_date : periodEnd;
    if (from > to) continue;
    const span = rangeDays(r.start_date, r.end_date);
    const days = r.pto_days === null || r.pto_days === "" ? span : Number(r.pto_days);
    const through = (k: number) => Math.round((days * k) / span);
    const daysIn = through(rangeDays(r.start_date, to)) - through(rangeDays(r.start_date, from) - 1);
    total += daysIn * PTO_DAY_HOURS;
  }
  return r2(total);
}

/** Hours from an approved timecard snapshot (minutes → decimal hours). */
export function hoursFromSnapshot(s: ApprovalSnapshot | null): PayHours {
  if (!s) return zeroHours();
  return {
    regular: r2(hours(s.regular)),
    overtime: r2(hours(s.overtime)),
    double_time: r2(hours(s.doubleTime)),
    meal_premium: s.mealPremiums,
    pto: 0,
  };
}

/** Apply HR overrides (any order; the newest per field wins, null clears). */
export function applyOverrides(
  base: Omit<PayLine, "hours" | "overridden" | "excluded" | "reasons">,
  overrides: readonly OverrideRow[],
): PayLine {
  const latest = new Map<string, OverrideRow>();
  for (const o of [...overrides].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(o.field, o);
  const hrs = { ...base.calculated };
  const overridden: PayField[] = [];
  const reasons: string[] = [];
  let excluded = false;
  for (const [field, o] of latest) {
    if (o.hours === null || o.hours === "") continue;
    const v = Number(o.hours);
    if (!Number.isFinite(v)) continue;
    if (field === "exclude") {
      excluded = v === 1;
      if (excluded) reasons.push(o.reason);
      continue;
    }
    if (!(PAY_FIELDS as readonly string[]).includes(field)) continue;
    hrs[field as PayField] = r2(v);
    overridden.push(field as PayField);
    reasons.push(o.reason);
  }
  return { ...base, hours: hrs, overridden, excluded, reasons: reasons.reverse() };
}

/** Problems that stop "Complete review" (empty = ready). */
export function reviewBlockers(lines: readonly PayLine[]): string[] {
  const out: string[] = [];
  const included = lines.filter((l) => !l.excluded && PAY_FIELDS.some((f) => l.hours[f] !== 0));
  const noId = included.filter((l) => !l.adp_employee_id);
  if (noId.length) {
    out.push(
      `${noId.length} employee(s) have hours but no ADP RUN Employee ID (${noId
        .slice(0, 5)
        .map((l) => l.name)
        .join(", ")}${noId.length > 5 ? "…" : ""}). Add it on the HR profile, or leave them out with a reason.`,
    );
  }
  const negative = lines.filter((l) => PAY_FIELDS.some((f) => l.hours[f] < 0));
  if (negative.length) out.push(`${negative.length} line(s) have negative hours.`);
  return out;
}

/** Warnings that don't block (shown on the review page). */
export function reviewWarnings(lines: readonly PayLine[]): string[] {
  const out: string[] = [];
  const unknown = lines.filter((l) => !l.excluded && l.flsa === "unknown").length;
  if (unknown) out.push(`${unknown} employee(s) have no FLSA status — treated as non-exempt (overtime and premiums apply).`);
  const exempt = lines.filter((l) => !l.excluded && l.flsa === "exempt" && l.hours.regular > 0).length;
  if (exempt) {
    out.push(
      `${exempt} exempt (salaried) employee(s) have regular hours. RUN pays salary automatically — leave them out, or keep only their PTO, unless Payroll wants hours imported for them.`,
    );
  }
  return out;
}

export type ReviewedLine = Pick<PayLine, "person_id" | "name" | "adp_employee_id" | "flsa" | "hours">;

/** The frozen copy stored at "Complete review": included lines only, stable order. */
export function freezeLines(lines: readonly PayLine[]): ReviewedLine[] {
  return lines
    .filter((l) => !l.excluded && PAY_FIELDS.some((f) => l.hours[f] !== 0))
    .map((l) => ({ person_id: l.person_id, name: l.name, adp_employee_id: l.adp_employee_id, flsa: l.flsa, hours: { ...l.hours } }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.person_id.localeCompare(b.person_id));
}

/** True when the live review no longer matches the frozen copy (e.g. PTO approved after review). */
export function reviewStale(frozen: readonly ReviewedLine[] | null, live: readonly PayLine[]): boolean {
  if (!frozen) return false;
  return JSON.stringify(frozen) !== JSON.stringify(freezeLines(live));
}

export function reviewTotals(lines: readonly ReviewedLine[]): PayHours & { employees: number } {
  const t = zeroHours();
  for (const l of lines) for (const f of PAY_FIELDS) t[f] = r2(t[f] + l.hours[f]);
  return { ...t, employees: lines.length };
}
