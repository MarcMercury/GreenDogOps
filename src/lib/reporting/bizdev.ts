import type {
  BizDevLocation,
  BizDevOpenDays,
  BizDevWeekdayFactors,
} from "./types";
import { APPOINTMENT_TYPES } from "@/lib/planning/types";

/** Average number of weeks in a month (52 / 12) for the monthly roll-up. */
export const WEEKS_PER_MONTH = 52 / 12;

export interface BizDevDayDef {
  key: keyof BizDevOpenDays;
  factorKey: keyof BizDevWeekdayFactors;
  /** 0 = Sunday, matching JS getDay(). */
  weekday: number;
  label: string;
  title: string;
}

export const DAY_DEFS: BizDevDayDef[] = [
  { key: "open_sun", factorKey: "factor_sun", weekday: 0, label: "S", title: "Sunday" },
  { key: "open_mon", factorKey: "factor_mon", weekday: 1, label: "M", title: "Monday" },
  { key: "open_tue", factorKey: "factor_tue", weekday: 2, label: "T", title: "Tuesday" },
  { key: "open_wed", factorKey: "factor_wed", weekday: 3, label: "W", title: "Wednesday" },
  { key: "open_thu", factorKey: "factor_thu", weekday: 4, label: "T", title: "Thursday" },
  { key: "open_fri", factorKey: "factor_fri", weekday: 5, label: "F", title: "Friday" },
  { key: "open_sat", factorKey: "factor_sat", weekday: 6, label: "S", title: "Saturday" },
];

export function openDayCount(d: BizDevOpenDays): number {
  return DAY_DEFS.reduce((n, def) => n + (d[def.key] ? 1 : 0), 0);
}

/** Sum of the volume factors for the clinic's OPEN days (Σ factor over open days). */
export function openDayFactorSum(loc: BizDevLocation): number {
  return DAY_DEFS.reduce(
    (s, def) =>
      s + (loc.open_days[def.key] ? Number(loc.weekday_factors[def.factorKey] ?? 1) : 0),
    0,
  );
}

export interface LocTotals {
  /** Sum of realized avg appointments per day (current run-rate reference). */
  currentApptsPerDay: number;
  /** Planned appts/day across DAILY-cadence rows only. */
  plannedApptsPerDayDaily: number;
  /** Planned appts/week across WEEKLY-cadence rows only. */
  plannedWeeklyAppts: number;
  /** Expected planned appts on a typical (factor = 1) open day. */
  plannedApptsTypicalDay: number;
  /** Factor-weighted planned appts per week. */
  plannedApptsPerWeek: number;
  projWeekly: number;
  projDailyEffective: number;
  currentWeekly: number;
  projMonthly: number;
  currentMonthly: number;
  openDays: number;
  factorSum: number;
}

export function computeTotals(loc: BizDevLocation): LocTotals {
  const openDays = openDayCount(loc.open_days);
  const factorSum = openDayFactorSum(loc);
  let currentApptsPerDay = 0;
  let plannedApptsPerDayDaily = 0;
  let plannedWeeklyAppts = 0;
  let projWeekly = 0;
  let currentWeekly = 0;
  for (const t of loc.types) {
    if (!t.included) continue;
    // Current run-rate: realized daily average, weighted by the weekday mix.
    currentApptsPerDay += t.avg_per_day;
    currentWeekly += t.avg_per_day * t.avg_value * factorSum;
    if (t.cadence === "weekly") {
      // A weekly service happens N times per week regardless of open-day count.
      plannedWeeklyAppts += t.planned_per_week;
      projWeekly += t.planned_per_week * t.avg_value;
    } else {
      plannedApptsPerDayDaily += t.planned_per_day;
      // Weight the week by the sum of open-day factors (Saturdays lighter, etc.).
      projWeekly += t.planned_per_day * t.avg_value * factorSum;
    }
  }
  const plannedApptsTypicalDay =
    plannedApptsPerDayDaily + (openDays > 0 ? plannedWeeklyAppts / openDays : 0);
  const plannedApptsPerWeek = plannedApptsPerDayDaily * factorSum + plannedWeeklyAppts;
  return {
    currentApptsPerDay,
    plannedApptsPerDayDaily,
    plannedWeeklyAppts,
    plannedApptsTypicalDay,
    plannedApptsPerWeek,
    projWeekly,
    projDailyEffective: openDays > 0 ? projWeekly / openDays : projWeekly,
    currentWeekly,
    projMonthly: projWeekly * WEEKS_PER_MONTH,
    currentMonthly: currentWeekly * WEEKS_PER_MONTH,
    openDays,
    factorSum,
  };
}

// ---------------------------------------------------------------------------
// Business Development → Planning Guide conversion
//
// The planner says HOW MANY of each appointment type a clinic intends to render
// on an open day. This turns that into the planning-guide layout: one column per
// appointment type, one row per time bucket, with the day's appointments spread
// across the day using the clinic's realized hourly demand curve.
// ---------------------------------------------------------------------------

/** Day window used when a clinic has no realized hourly demand yet. */
const FALLBACK_START_HOUR = 8;
const FALLBACK_END_HOUR = 18;

/** Distinct colors for appointment types with no planning-palette match. */
const EXTRA_COLORS = [
  "#0ea5e9",
  "#f43f5e",
  "#8b5cf6",
  "#f59e0b",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#ec4899",
  "#0891b2",
  "#a855f7",
];

/** Match an ezyVet appointment type name to the planning guide palette. */
function planningCodeFor(name: string): string | null {
  const n = name.toLowerCase();
  if (/exotic/.test(n)) {
    if (/recheck/.test(n)) return "ex_recheck";
    if (/well/.test(n)) return "ex_wellness";
    if (/groom|tech/.test(n)) return "ex_groom";
    return "ex_sick";
  }
  if (/urgent|emergen|uc\b/.test(n)) return "uc";
  if (/dental|dentistry/.test(n)) return "dental";
  if (/acupunct/.test(n)) return "acu";
  if (/internal med|ultrasound|\bim\b|endoscop/.test(n)) return "im";
  if (/drop\s?off/.test(n)) return "drop";
  if (/tech/.test(n)) return "tech";
  if (/new animal|\bnad\b|\boe\b|wellness|annual|puppy|kitten/.test(n)) return "nad";
  if (/exam|consult|recheck|sick|visit/.test(n)) return "ve";
  if (/surgery|procedure|surgical/.test(n)) return "dental";
  return null;
}

/** A short chip label for an appointment type with no palette match. */
function shortLabel(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "APPT";
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export interface DayPlanColumn {
  /** The bizdev appt-type row id. */
  id: string;
  name: string;
  short: string;
  color: string;
  /** Appointments placed on this day. */
  count: number;
  avgValue: number;
  revenue: number;
  cadence: "daily" | "weekly";
  /** Set when the plan exceeds the type's Max/day ceiling. */
  overCap: boolean;
}

export interface DayPlanSlot {
  id: string;
  columnId: string;
  startMinute: number;
  durationMinutes: number;
}

export interface BizDevDayPlan {
  locationId: string;
  locationKey: BizDevLocation["location_key"];
  locationLabel: string;
  /** 0 = Sunday. */
  weekday: number;
  weekdayLabel: string;
  isOpen: boolean;
  /** Weekday volume factor applied to the daily-cadence rows. */
  factor: number;
  startMinute: number;
  endMinute: number;
  stepMinutes: number;
  buckets: number[];
  columns: DayPlanColumn[];
  slots: DayPlanSlot[];
  totalAppts: number;
  totalRevenue: number;
  /** False when the clinic has no realized hourly demand to lay the day out by. */
  hasHourDemand: boolean;
}

/**
 * Spread `count` items across `weights` (largest-remainder) so the totals match
 * exactly and the busiest buckets get the extras.
 */
function distribute(count: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (count <= 0 || weights.length === 0) return weights.map(() => 0);
  const even = total <= 0;
  const exact = weights.map((w) =>
    even ? count / weights.length : (count * w) / total,
  );
  const base = exact.map((n) => Math.floor(n));
  let left = count - base.reduce((s, n) => s + n, 0);
  const order = exact
    .map((n, i) => ({ i, rem: n - Math.floor(n) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) {
    base[order[k % order.length].i] += 1;
  }
  return base;
}

/**
 * Convert one clinic's Business Development plan into a planning-guide layout
 * for a given weekday.
 */
export function buildDayPlan(
  loc: BizDevLocation,
  weekday: number,
  stepMinutes: number,
): BizDevDayPlan {
  const def = DAY_DEFS.find((d) => d.weekday === weekday) ?? DAY_DEFS[1];
  const isOpen = Boolean(loc.open_days[def.key]);
  const factor = Number(loc.weekday_factors[def.factorKey] ?? 1) || 1;
  const openDays = openDayCount(loc.open_days);

  // Day window: the hours the clinic actually books, else a sensible default.
  const busyHours = loc.hour_demand
    .filter((h) => h.avg_per_open_day > 0)
    .map((h) => h.hour);
  const startHour = busyHours.length ? Math.min(...busyHours) : FALLBACK_START_HOUR;
  const endHour = busyHours.length
    ? Math.max(Math.max(...busyHours) + 1, startHour + 1)
    : FALLBACK_END_HOUR;
  const startMinute = startHour * 60;
  const endMinute = endHour * 60;

  const buckets: number[] = [];
  for (let t = startMinute; t < endMinute; t += stepMinutes) buckets.push(t);

  const demandByHour = new Map(
    loc.hour_demand.map((h) => [h.hour, h.avg_per_open_day]),
  );
  const weights = buckets.map((b) => demandByHour.get(Math.floor(b / 60)) ?? 0);

  const columns: DayPlanColumn[] = [];
  const slots: DayPlanSlot[] = [];
  let extraColor = 0;

  const planned = loc.types
    .filter((t) => t.included && !t.hidden)
    .map((t) => {
      // Weekly services happen N times a week regardless of the day's factor;
      // daily services scale with how busy that weekday runs.
      const eff =
        t.cadence === "weekly"
          ? openDays > 0
            ? t.planned_per_week / openDays
            : t.planned_per_week
          : t.planned_per_day * factor;
      return { row: t, count: Math.round(eff), eff };
    })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count || a.row.appt_type.localeCompare(b.row.appt_type));

  for (const { row, count, eff } of planned) {
    const code = planningCodeFor(row.appt_type);
    const palette = code ? APPOINTMENT_TYPES.find((a) => a.code === code) : undefined;
    const color = palette?.color ?? EXTRA_COLORS[extraColor++ % EXTRA_COLORS.length];
    columns.push({
      id: row.id,
      name: row.appt_type,
      short: palette?.short ?? shortLabel(row.appt_type),
      color,
      count,
      avgValue: row.avg_value,
      revenue: count * row.avg_value,
      cadence: row.cadence,
      overCap: row.max_per_day > 0 && eff > row.max_per_day + 0.001,
    });
    const perBucket = distribute(count, weights);
    perBucket.forEach((n, i) => {
      for (let k = 0; k < n; k++) {
        slots.push({
          id: `${row.id}:${buckets[i]}:${k}`,
          columnId: row.id,
          startMinute: buckets[i],
          durationMinutes: stepMinutes,
        });
      }
    });
  }

  return {
    locationId: loc.location_id,
    locationKey: loc.location_key,
    locationLabel: loc.location_label,
    weekday,
    weekdayLabel: def.title,
    isOpen,
    factor,
    startMinute,
    endMinute,
    stepMinutes,
    buckets,
    columns,
    slots,
    totalAppts: columns.reduce((s, c) => s + c.count, 0),
    totalRevenue: columns.reduce((s, c) => s + c.revenue, 0),
    hasHourDemand: busyHours.length > 0,
  };
}
