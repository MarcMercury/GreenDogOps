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

/** One lane of a department track: a single appointment type, one appt per slot. */
export interface DayPlanColumn {
  /** `${departmentId}:${trackType}:${apptType}:${lane}`. */
  id: string;
  /** The appointment type this lane books — types never share a lane. */
  name: string;
  short: string;
  /** Track name from the shared rules, e.g. "NAD / Clinic" or "Urgent Care". */
  trackName: string;
  /** The schedule department this track belongs to. */
  deptName: string;
  color: string;
  /** Appointments placed on this day. */
  count: number;
  avgValue: number;
  revenue: number;
  cadence: "daily" | "weekly";
  /** Set when the plan exceeds the type's Max/day ceiling. */
  overCap: boolean;
  /** 1-based lane number when a type needs more than one to fit the day. */
  lane: number;
  laneCount: number;
}

export interface DayPlanSlot {
  id: string;
  columnId: string;
  startMinute: number;
  durationMinutes: number;
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
 * How many appointments the whole clinic should start in each time bucket.
 * Demand-weighted, but capped so the busy hours can't swallow the day — the
 * point of the guide is a workable, level schedule across the open hours.
 */
function bucketTargets(total: number, weights: number[], cap: number): number[] {
  const size = weights.length;
  const out = new Array<number>(size).fill(0);
  if (total <= 0 || size === 0 || cap <= 0) return out;

  const usable = Math.min(total, size * cap);
  const anyWeight = weights.some((w) => w > 0);
  const w = anyWeight ? weights : weights.map(() => 1);
  const wSum = w.reduce((s, x) => s + x, 0);
  const exact = w.map((x) => (usable * x) / wSum);

  let placed = 0;
  for (let i = 0; i < size; i++) {
    out[i] = Math.min(cap, Math.floor(exact[i]));
    placed += out[i];
  }
  // Hand out what rounding left over, busiest bucket first, never past the cap.
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  while (placed < usable) {
    let progressed = false;
    for (const o of order) {
      if (placed >= usable) break;
      if (out[o.i] < cap) {
        out[o.i] += 1;
        placed += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
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

  // Every planning department contributes its standard tracks, in setup order;
  // a type is then given its OWN lane(s) inside its track so two appointment
  // types never share a column, and a lane never double-books a time slot.
  const trackOrder: { key: string; deptName: string; track: GuideTrack }[] = [];
  const trackIndex = new Map<string, number>();
  const tracksByDept = new Map<string, GuideTrack[]>();
  for (const dept of rules.planningDepartments) {
    const tracks = guideTracksFor(dept.name, 1);
    tracksByDept.set(dept.id, tracks);
    for (const track of tracks) {
      const key = `${dept.id}:${track.type}`;
      trackIndex.set(key, trackOrder.length);
      trackOrder.push({ key, deptName: dept.name, track });
    }
  }

  const built: { col: DayPlanColumn; order: number; total: number }[] = [];
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
    const tracks = tracksByDept.get(deptId);
    if (!tracks) {
      excluded.push({
        apptType: row.appt_type,
        count,
        reason: "non-planning",
        deptName: rules.departmentNames[deptId] ?? null,
      });
      continue;
    }
    const track = trackForApptType(tracks, row.appt_type);
    const trackKey = `${deptId}:${track.type}`;
    const order = trackIndex.get(trackKey) ?? trackOrder.length;
    const deptName = rules.departmentNames[deptId] ?? "";

    const code = planningCodeFor(row.appt_type);
    const palette = code ? APPOINTMENT_TYPES.find((a) => a.code === code) : undefined;
    const short = palette?.short ?? shortLabel(row.appt_type);
    const color = palette?.color ?? EXTRA_COLORS[extraColor++ % EXTRA_COLORS.length];

    // One lane holds at most one appointment per slot, so a type that can't fit
    // the day in a single lane opens parallel lanes (two rooms running it).
    const laneCount = Math.max(1, Math.ceil(count / buckets.length));
    for (let lane = 0; lane < laneCount; lane++) {
      const laneAppts =
        Math.floor(count / laneCount) + (lane < count % laneCount ? 1 : 0);
      if (laneAppts <= 0) continue;
      const id = `${trackKey}:${row.id}:${lane}`;
      built.push({
        order,
        total: count,
        col: {
          id,
          name: row.appt_type,
          short,
          trackName: track.name,
          deptName,
          color,
          count: laneAppts,
          avgValue: row.avg_value,
          revenue: laneAppts * row.avg_value,
          cadence: row.cadence,
          overCap: row.max_per_day > 0 && eff > row.max_per_day + 0.001,
          lane: lane + 1,
          laneCount,
        },
      });
    }
  }

  // Department/track order first, then the busiest types, then lane number.
  const columns = built
    .sort(
      (a, b) =>
        a.order - b.order ||
        b.total - a.total ||
        a.col.name.localeCompare(b.col.name) ||
        a.col.lane - b.col.lane,
    )
    .map((b) => b.col);

  // Book the day as a whole rather than each lane on its own, or every type
  // piles onto the same busy hour. Each bucket takes its share of the day's
  // appointments (demand-weighted, capped), handed to whichever lanes have
  // fallen furthest behind the pace they need to finish the day — so lanes
  // spread out instead of running back-to-back, and a lane still never books
  // two appointments at the same time.
  const totalAppts = columns.reduce((s, c) => s + c.count, 0);
  const maxConcurrent = Math.max(
    1,
    Math.ceil((totalAppts / Math.max(1, buckets.length)) * 1.5),
  );
  const targets = bucketTargets(totalAppts, weights, maxConcurrent);

  const weightTotal = weights.reduce((s, x) => s + x, 0);
  const elapsed: number[] = [];
  let run = 0;
  for (let i = 0; i < buckets.length; i++) {
    run += weightTotal > 0 ? weights[i] : 1;
    elapsed.push(weightTotal > 0 ? run / weightTotal : (i + 1) / buckets.length);
  }

  const lanes = columns.map((col, idx) => ({ col, idx, left: col.count }));
  for (let i = 0; i < buckets.length; i++) {
    let room = targets[i];
    if (room <= 0) continue;
    const ready = lanes
      .filter((l) => l.left > 0)
      // How many this lane "should" have started by now, minus what it has.
      .map((l) => ({ l, behind: l.col.count * elapsed[i] - (l.col.count - l.left) }))
      .sort((a, b) => b.behind - a.behind || a.l.idx - b.l.idx);
    for (const { l } of ready) {
      if (room <= 0) break;
      l.left -= 1;
      room -= 1;
      slots.push({
        id: `${l.col.id}:${buckets[i]}`,
        columnId: l.col.id,
        startMinute: buckets[i],
        durationMinutes: stepMinutes,
      });
    }
  }
  // Anything the capped targets couldn't fit goes in this lane's first free slot.
  for (const l of lanes) {
    if (l.left <= 0) continue;
    const used = new Set(
      slots.filter((s) => s.columnId === l.col.id).map((s) => s.startMinute),
    );
    for (const b of buckets) {
      if (l.left <= 0) break;
      if (used.has(b)) continue;
      used.add(b);
      l.left -= 1;
      slots.push({
        id: `${l.col.id}:${b}`,
        columnId: l.col.id,
        startMinute: b,
        durationMinutes: stepMinutes,
      });
    }
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
    excluded,
    totalAppts,
    totalRevenue: columns.reduce((s, c) => s + c.revenue, 0),
    hasHourDemand,
  };
}
