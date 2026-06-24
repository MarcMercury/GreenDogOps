// Resolver that links the Schedule to the Planning Guides.
//
// The Schedule is authored first. For any (location, department, day) we count
// the DVMs actually staffed and then pick the planning guide whose staffing
// signature (`dvm_count`) matches — that guide is the day's appointment-capacity
// output. This module is pure (no DB) so it can run on the server when building
// the schedule page or be unit-tested in isolation.

import type { PlanningGuide } from "./types";

/** A planning guide enriched with its bookable-slot total (for capacity rollups). */
export interface GuideWithCapacity extends PlanningGuide {
  bookable: number;
  columns: number;
}

/** The guide chosen for one staffed department on one day, plus rollup data. */
export interface CapacityEntry {
  departmentId: string;
  departmentName: string;
  departmentColor: string;
  dvmCount: number;
  guide: GuideWithCapacity | null;
  /** True when the resolved guide's dvm_count equals the staffed DVM count. */
  exact: boolean;
  bookable: number;
}

/** Resolved capacity for a single (day, location) cell of the schedule. */
export interface DayLocationCapacity {
  day: number; // 0=Sun .. 6=Sat
  locationId: string;
  entries: CapacityEntry[];
  totalBookable: number;
}

// Minimal row shapes the resolver needs from the schedule side. Kept structural
// so callers can pass their existing Sched* rows without adapters.
interface AssignmentRow {
  line_id: string;
  location_id: string;
  person_id: string;
  day_of_week: number;
  removed_post_publish?: boolean;
}
interface LineRow {
  id: string;
  department_id: string;
  role_id: string | null;
}
interface RoleRow {
  id: string;
  name: string;
}
interface DepartmentRow {
  id: string;
  name: string;
  color: string;
  show_in_planning: boolean;
}

/** A role counts as a doctor line when its name is (or contains) "DVM". */
function isDvmRole(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\bdvm\b/i.test(name);
}

/**
 * Pick the best guide for a staffing signature. Ranking, best first:
 *   1. exact dvm_count match
 *   2. smallest staffing gap (under-staffed guides preferred over over-staffed)
 *   3. weekday-specific variants over generic (any-day) ones
 *   4. higher dvm_count as a final, stable tie-break
 * Guides with non-empty `weekdays` only apply on those weekdays.
 */
export function resolveGuide(
  locationId: string,
  departmentId: string,
  day: number,
  dvmCount: number,
  guides: GuideWithCapacity[],
): { guide: GuideWithCapacity; exact: boolean } | null {
  const applicable = guides.filter(
    (g) =>
      g.status === "active" &&
      g.location_id === locationId &&
      g.department_id === departmentId &&
      (g.weekdays.length === 0 || g.weekdays.includes(day)),
  );
  if (!applicable.length) return null;

  const rank = (g: GuideWithCapacity): [number, number, number, number] => {
    const d = g.dvm_count ?? 99;
    const diff = d - dvmCount;
    const exactMiss = diff === 0 ? 0 : 1;
    // Under-staffed (diff < 0) costs its magnitude; over-staffed costs slightly
    // more so an equal-or-lower guide is preferred when both are off-target.
    const gap = diff === 0 ? 0 : diff < 0 ? -diff : diff + 0.5;
    const generic = g.weekdays.length === 0 ? 1 : 0;
    return [exactMiss, gap, generic, -d];
  };

  const best = [...applicable].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  })[0];

  return { guide: best, exact: (best.dvm_count ?? -1) === dvmCount };
}

/**
 * Build the per-(day, location) appointment-capacity rollup for a week from its
 * staffed assignments. Only departments flagged `show_in_planning` that have at
 * least one DVM staffed are surfaced; each is matched to its best guide.
 */
export function computeWeekCapacity(
  assignments: AssignmentRow[],
  lines: LineRow[],
  roles: RoleRow[],
  departments: DepartmentRow[],
  guides: GuideWithCapacity[],
): Map<string, DayLocationCapacity> {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // Count DISTINCT DVMs per (day | location | department); a doctor with two
  // shift lines the same day is one head, not two.
  const dvmsByCell = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (a.removed_post_publish) continue;
    const line = lineById.get(a.line_id);
    if (!line) continue;
    const role = line.role_id ? roleById.get(line.role_id) : null;
    if (!isDvmRole(role?.name)) continue;
    const key = `${a.day_of_week}|${a.location_id}|${line.department_id}`;
    const set = dvmsByCell.get(key) ?? new Set<string>();
    set.add(a.person_id);
    dvmsByCell.set(key, set);
  }

  const out = new Map<string, DayLocationCapacity>();
  for (const [key, people] of dvmsByCell) {
    const [dayStr, locationId, departmentId] = key.split("|");
    const dept = deptById.get(departmentId);
    if (!dept || !dept.show_in_planning) continue;
    const day = Number(dayStr);
    const dvmCount = people.size;

    const match = resolveGuide(locationId, departmentId, day, dvmCount, guides);
    const entry: CapacityEntry = {
      departmentId,
      departmentName: dept.name,
      departmentColor: dept.color,
      dvmCount,
      guide: match?.guide ?? null,
      exact: match?.exact ?? false,
      bookable: match?.guide.bookable ?? 0,
    };

    const cellKey = `${day}|${locationId}`;
    const cell =
      out.get(cellKey) ??
      ({ day, locationId, entries: [], totalBookable: 0 } as DayLocationCapacity);
    cell.entries.push(entry);
    cell.totalBookable += entry.bookable;
    out.set(cellKey, cell);
  }

  // Stable ordering of entries within a cell (department sort by name).
  for (const cell of out.values()) {
    cell.entries.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  }
  return out;
}
