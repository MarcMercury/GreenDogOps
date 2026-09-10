import type {
  BizDevHours,
  BizDevLocation,
  BizDevOpenDays,
  BizDevWeekdayFactors,
} from "./types";
import { APPOINTMENT_TYPES } from "@/lib/planning/types";
import type { GuideTrack } from "@/lib/planning/tracks";
import { guideTracksFor, planningCodeFor, trackForApptType } from "@/lib/planning/tracks";

/** Average number of weeks in a month (52 / 12) for the monthly roll-up. */
export const WEEKS_PER_MONTH = 52 / 12;

export interface BizDevDayDef {
  key: keyof BizDevOpenDays;
  factorKey: keyof BizDevWeekdayFactors;
  openKey: keyof BizDevHours;
  closeKey: keyof BizDevHours;
  /** 0 = Sunday, matching JS getDay(). */
  weekday: number;
  label: string;
  title: string;
}

export const DAY_DEFS: BizDevDayDef[] = [
  { key: "open_sun", factorKey: "factor_sun", openKey: "open_min_sun", closeKey: "close_min_sun", weekday: 0, label: "S", title: "Sunday" },
  { key: "open_mon", factorKey: "factor_mon", openKey: "open_min_mon", closeKey: "close_min_mon", weekday: 1, label: "M", title: "Monday" },
  { key: "open_tue", factorKey: "factor_tue", openKey: "open_min_tue", closeKey: "close_min_tue", weekday: 2, label: "T", title: "Tuesday" },
  { key: "open_wed", factorKey: "factor_wed", openKey: "open_min_wed", closeKey: "close_min_wed", weekday: 3, label: "W", title: "Wednesday" },
  { key: "open_thu", factorKey: "factor_thu", openKey: "open_min_thu", closeKey: "close_min_thu", weekday: 4, label: "T", title: "Thursday" },
  { key: "open_fri", factorKey: "factor_fri", openKey: "open_min_fri", closeKey: "close_min_fri", weekday: 5, label: "F", title: "Friday" },
  { key: "open_sat", factorKey: "factor_sat", openKey: "open_min_sat", closeKey: "close_min_sat", weekday: 6, label: "S", title: "Saturday" },
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

/** Day window used when a clinic has no configured hours. */
export const DEFAULT_OPEN_MINUTE = 8 * 60;
export const DEFAULT_CLOSE_MINUTE = 18 * 60;

/**
 * How much of the busiest hour's demand every open hour is guaranteed. Without
 * a floor the plan piles onto the historically busy hours and leaves the rest
 * of the open day empty; the point of setting hours is to fill them.
 */
const QUIET_HOUR_FLOOR = 0.35;

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

/** One appointment type's share of a track. */
export interface DayPlanType {
  name: string;
  short: string;
  color: string;
  count: number;
  avgValue: number;
  revenue: number;
  cadence: "daily" | "weekly";
  /** Set when the plan exceeds the type's Max/day ceiling. */
  overCap: boolean;
}

export interface DayPlanColumn {
  /** `${departmentId}:${trackType}`. */
  id: string;
  /** Track name from the shared rules, e.g. "NAD / Clinic" or "Urgent Care". */
  name: string;
  /** The schedule department this track belongs to. */
  deptName: string;
  color: string;
  /** Appointments placed on this day. */
  count: number;
  revenue: number;
  types: DayPlanType[];
}

export interface DayPlanSlot {
  id: string;
  columnId: string;
  startMinute: number;
  durationMinutes: number;
  /** Chip label — the appointment type's short code. */
  short: string;
  typeName: string;
  color: string;
}

/** A planned appointment type that can't be laid out, and why. */
export interface DayPlanExclusion {
  apptType: string;
  count: number;
  reason: "ignored" | "unmapped" | "non-planning";
  deptName: string | null;
}

/**
 * The Planning Guide Setup rules (Schedule ▸ Set Up): which department renders
 * each ezyVet appointment type, and which departments are planning areas.
 */
export interface PlanningTrackRules {
  /** Active departments flagged show_in_planning, in display order. */
  planningDepartments: { id: string; name: string; color: string }[];
  /** Every active department, for naming non-planning exclusions. */
  departmentNames: Record<string, string>;
  /** appt_type → { department_id, is_ignored } from ezyvet_appt_type_dept_map. */
  apptTypeDept: Record<string, { departmentId: string | null; isIgnored: boolean }>;
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
  /** Planned types the Planning Guide Setup rules keep off the guide. */
  excluded: DayPlanExclusion[];
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
 * for a given weekday, following the same rules as the Operations planning
 * guides: appointment types are attributed to the department that renders them
 * (Schedule ▸ Set Up ▸ Planning Guide Setup), and each department contributes
 * its standard appointment tracks as the guide's columns.
 */
export function buildDayPlan(
  loc: BizDevLocation,
  weekday: number,
  stepMinutes: number,
  rules: PlanningTrackRules,
): BizDevDayPlan {
  const def = DAY_DEFS.find((d) => d.weekday === weekday) ?? DAY_DEFS[1];
  const isOpen = Boolean(loc.open_days[def.key]);
  const factor = Number(loc.weekday_factors[def.factorKey] ?? 1) || 1;
  const openDays = openDayCount(loc.open_days);

  // The day window is the clinic's configured hours for this weekday, so the
  // plan fills the whole time the clinic is open.
  const startMinute = Number(loc.hours?.[def.openKey] ?? DEFAULT_OPEN_MINUTE);
  const endMinute = Math.max(
    Number(loc.hours?.[def.closeKey] ?? DEFAULT_CLOSE_MINUTE),
    startMinute + stepMinutes,
  );

  const buckets: number[] = [];
  for (let t = startMinute; t < endMinute; t += stepMinutes) buckets.push(t);

  // Shape the day by realized hourly demand, but keep a floor under the quiet
  // hours so open time never goes unplanned.
  const demandByHour = new Map(
    loc.hour_demand.map((h) => [h.hour, h.avg_per_open_day]),
  );
  const hasHourDemand = loc.hour_demand.some((h) => h.avg_per_open_day > 0);
  const peak = Math.max(0, ...loc.hour_demand.map((h) => h.avg_per_open_day));
  const floor = hasHourDemand ? peak * QUIET_HOUR_FLOOR : 0;
  const weights = buckets.map((b) =>
    Math.max(demandByHour.get(Math.floor(b / 60)) ?? 0, floor),
  );

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

  // Every planning department contributes its standard tracks, in setup order.
  const columns: DayPlanColumn[] = [];
  const columnByKey = new Map<string, DayPlanColumn>();
  const trackOwner = new Map<string, { deptId: string; track: GuideTrack }[]>();
  for (const dept of rules.planningDepartments) {
    const tracks = guideTracksFor(dept.name, 1);
    trackOwner.set(dept.id, tracks.map((track) => ({ deptId: dept.id, track })));
    for (const track of tracks) {
      const id = `${dept.id}:${track.type}`;
      const col: DayPlanColumn = {
        id,
        name: track.name,
        deptName: dept.name,
        color: track.color,
        count: 0,
        revenue: 0,
        types: [],
      };
      columns.push(col);
      columnByKey.set(id, col);
    }
  }

  const slots: DayPlanSlot[] = [];
  const excluded: DayPlanExclusion[] = [];
  let extraColor = 0;

  for (const { row, count, eff } of planned) {
    const mapping = rules.apptTypeDept[row.appt_type.trim()];
    const deptId = mapping?.departmentId ?? null;
    if (mapping?.isIgnored) {
      excluded.push({ apptType: row.appt_type, count, reason: "ignored", deptName: null });
      continue;
    }
    if (!deptId) {
      excluded.push({ apptType: row.appt_type, count, reason: "unmapped", deptName: null });
      continue;
    }
    const tracks = trackOwner.get(deptId);
    if (!tracks) {
      excluded.push({
        apptType: row.appt_type,
        count,
        reason: "non-planning",
        deptName: rules.departmentNames[deptId] ?? null,
      });
      continue;
    }
    const track = trackForApptType(
      tracks.map((t) => t.track),
      row.appt_type,
    );
    const col = columnByKey.get(`${deptId}:${track.type}`);
    if (!col) continue;

    const code = planningCodeFor(row.appt_type);
    const palette = code ? APPOINTMENT_TYPES.find((a) => a.code === code) : undefined;
    const short = palette?.short ?? shortLabel(row.appt_type);
    const chipColor =
      palette?.color ?? EXTRA_COLORS[extraColor++ % EXTRA_COLORS.length];

    col.count += count;
    col.revenue += count * row.avg_value;
    col.types.push({
      name: row.appt_type,
      short,
      color: chipColor,
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
          columnId: col.id,
          startMinute: buckets[i],
          durationMinutes: stepMinutes,
          short,
          typeName: row.appt_type,
          color: chipColor,
        });
      }
    });
  }

  // Only show tracks that have something planned.
  const usedColumns = columns.filter((c) => c.count > 0);

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
    columns: usedColumns,
    slots,
    excluded,
    totalAppts: usedColumns.reduce((s, c) => s + c.count, 0),
    totalRevenue: usedColumns.reduce((s, c) => s + c.revenue, 0),
    hasHourDemand,
  };
}
