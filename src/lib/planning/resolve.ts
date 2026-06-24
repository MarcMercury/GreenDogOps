// Resolver that links the Schedule to the Planning Guides.
//
// The Schedule is authored first. For any (location, department, day) we read
// the full staffing signature actually scheduled — distinct DVMs in the
// department plus the location-wide support roles (Tech, Lead, Dental, DA,
// Float) — and pick the planning guide whose staffing key best matches. That
// guide is the day's appointment-capacity output. This module is pure (no DB)
// so it can run on the server when building a page or be unit-tested.

import type { PlanningGuide } from "./types";

// ---------------------------------------------------------------------------
// Staffing categories — the role buckets the Daily Capacity summary tracks.
// CSR/RCSR, Interns, Externs, managers and other non-clinical roles are
// intentionally excluded from the rollup and from guide matching.
// ---------------------------------------------------------------------------

export type StaffCategory = "dvm" | "tech" | "lead" | "dental" | "da" | "float";

export const STAFF_CATEGORIES: { key: StaffCategory; label: string }[] = [
  { key: "dvm", label: "DVM" },
  { key: "tech", label: "Tech" },
  { key: "lead", label: "Lead" },
  { key: "dental", label: "Dental" },
  { key: "da", label: "DA" },
  { key: "float", label: "Float" },
];

export type StaffingCounts = Record<StaffCategory, number>;

export function emptyStaffing(): StaffingCounts {
  return { dvm: 0, tech: 0, lead: 0, dental: 0, da: 0, float: 0 };
}

/**
 * Bucket a schedule role name into a staffing category, or null when it should
 * be ignored (CSR/RCSR, Intern/Extern, managers and other non-clinical roles).
 * Order matters: DVM and the excluded buckets are checked first, then dual
 * "Tech/DA" names resolve to Tech and "Float / Lead" resolves to Float.
 */
export function classifyRole(
  name: string | null | undefined,
): StaffCategory | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/\bdvm\b/.test(n)) return "dvm";
  if (/csr/.test(n)) return null; // CSR, RCSR, CSR Lead
  if (/intern|extern/.test(n)) return null;
  if (/dental/.test(n)) return "dental";
  if (/tech/.test(n)) return "tech"; // "IM Tech/DA", "Exotic Tech/DA" -> Tech
  if (/float/.test(n)) return "float"; // "Float / Lead" -> Float
  if (/lead/.test(n)) return "lead";
  if (/\bda\b/.test(n)) return "da";
  return null;
}

/** A planning guide enriched with its bookable-slot total (for capacity rollups). */
export interface GuideWithCapacity extends PlanningGuide {
  bookable: number;
  columns: number;
}

/** The full staffing signature for one department on one day. */
export type StaffingSignature = StaffingCounts;

/** The guide chosen for one staffed department on one day, plus rollup data. */
export interface CapacityEntry {
  departmentId: string;
  departmentName: string;
  departmentColor: string;
  dvmCount: number;
  guide: GuideWithCapacity | null;
  /** True when every staffing key the guide defines matches the staffing. */
  exact: boolean;
  bookable: number;
}

/** Resolved capacity for a single (day, location) cell of the schedule. */
export interface DayLocationCapacity {
  day: number; // 0=Sun .. 6=Sat
  locationId: string;
  /** Location-wide headcount per staffing category for the day. */
  staffing: StaffingCounts;
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

/** Map a staffing category to the planning_guide column that keys it. */
const SIG_FIELDS: { key: StaffCategory; col: keyof PlanningGuide }[] = [
  { key: "dvm", col: "dvm_count" },
  { key: "tech", col: "tech_count" },
  { key: "lead", col: "lead_count" },
  { key: "dental", col: "dental_count" },
  { key: "da", col: "da_count" },
  { key: "float", col: "float_count" },
];

/** DVM dominates the match; support roles fine-tune it. */
const FIELD_WEIGHT: Record<StaffCategory, number> = {
  dvm: 3,
  tech: 1,
  lead: 1,
  dental: 1,
  da: 1,
  float: 1,
};

/**
 * Pick the best guide for a staffing signature. A guide's staffing key is the
 * set of *_count columns it defines; null columns are wildcards (ignored).
 * Ranking, best first:
 *   1. fewest mismatched defined keys
 *   2. most exactly-matched defined keys (more specific wins on ties)
 *   3. smallest weighted gap (DVM weighted heaviest)
 *   4. weekday-specific variants over generic (any-day) ones
 *   5. more defined keys as a final, stable tie-break
 * Guides with non-empty `weekdays` only apply on those weekdays.
 */
export function resolveGuide(
  locationId: string,
  departmentId: string,
  day: number,
  signature: StaffingSignature,
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

  const score = (g: GuideWithCapacity) => {
    let miss = 0;
    let match = 0;
    let gap = 0;
    let defined = 0;
    for (const { key, col } of SIG_FIELDS) {
      const gv = g[col] as number | null;
      if (gv == null) continue;
      defined++;
      const diff = Math.abs(gv - signature[key]);
      if (diff === 0) match++;
      else miss++;
      gap += diff * FIELD_WEIGHT[key];
    }
    const generic = g.weekdays.length === 0 ? 1 : 0;
    return { miss, match, gap, generic, defined };
  };

  const best = [...applicable].sort((a, b) => {
    const ra = score(a);
    const rb = score(b);
    if (ra.miss !== rb.miss) return ra.miss - rb.miss;
    if (ra.match !== rb.match) return rb.match - ra.match;
    if (ra.gap !== rb.gap) return ra.gap - rb.gap;
    if (ra.generic !== rb.generic) return ra.generic - rb.generic;
    return rb.defined - ra.defined;
  })[0];

  const r = score(best);
  return { guide: best, exact: r.miss === 0 && r.match > 0 };
}

function addToSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

/**
 * Build the per-(day, location) appointment-capacity rollup for a week from its
 * staffed assignments. Each cell carries the location-wide staffing headcount
 * (DVM/Tech/Lead/Dental/DA/Float) plus, for every planning department that has
 * at least one DVM staffed, the best-matching guide. DVMs are counted within
 * their department; support roles are counted location-wide.
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

  // Distinct people per (day | location | category) — location-wide — and
  // distinct DVMs per (day | location | department) for guide matching.
  const locStaff = new Map<string, Set<string>>();
  const deptDvms = new Map<string, Set<string>>();

  for (const a of assignments) {
    if (a.removed_post_publish) continue;
    const line = lineById.get(a.line_id);
    if (!line) continue;
    const role = line.role_id ? roleById.get(line.role_id) : null;
    const cat = classifyRole(role?.name);
    if (!cat) continue;
    addToSet(locStaff, `${a.day_of_week}|${a.location_id}|${cat}`, a.person_id);
    if (cat === "dvm") {
      addToSet(
        deptDvms,
        `${a.day_of_week}|${a.location_id}|${line.department_id}`,
        a.person_id,
      );
    }
  }

  const out = new Map<string, DayLocationCapacity>();
  const cellFor = (day: number, locationId: string): DayLocationCapacity => {
    const key = `${day}|${locationId}`;
    let c = out.get(key);
    if (!c) {
      c = {
        day,
        locationId,
        staffing: emptyStaffing(),
        entries: [],
        totalBookable: 0,
      };
      out.set(key, c);
    }
    return c;
  };

  // Location-wide staffing summary per cell.
  for (const [key, people] of locStaff) {
    const [dayStr, locationId, cat] = key.split("|");
    cellFor(Number(dayStr), locationId).staffing[cat as StaffCategory] =
      people.size;
  }

  // Per-department DVM entries, each matched to its best guide.
  for (const [key, people] of deptDvms) {
    const [dayStr, locationId, departmentId] = key.split("|");
    const dept = deptById.get(departmentId);
    if (!dept || !dept.show_in_planning) continue;
    const day = Number(dayStr);
    const cell = cellFor(day, locationId);
    const signature: StaffingSignature = {
      ...cell.staffing,
      dvm: people.size,
    };
    const match = resolveGuide(
      locationId,
      departmentId,
      day,
      signature,
      guides,
    );
    const entry: CapacityEntry = {
      departmentId,
      departmentName: dept.name,
      departmentColor: dept.color,
      dvmCount: people.size,
      guide: match?.guide ?? null,
      exact: match?.exact ?? false,
      bookable: match?.guide.bookable ?? 0,
    };
    cell.entries.push(entry);
    cell.totalBookable += entry.bookable;
  }

  // Stable ordering of entries within a cell (department sort by name).
  for (const cell of out.values()) {
    cell.entries.sort((a, b) =>
      a.departmentName.localeCompare(b.departmentName),
    );
  }
  return out;
}
