import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { readSheetRange, listSheetTabs } from "@/lib/google/sheets";
import { clean, emptyResult, nameKey, todayLA, type SheetSyncResult } from "./common";

/**
 * Nightly pull of the "GDD Staff Schedule 2026" sheet.
 *
 * Scope is deliberately the nine VET-* rows, which map 1:1 onto a
 * (department, DVM) scheduling line, so no section-inheritance guessing is
 * needed. Weeks that are already published in the app are skipped by
 * greendogops.apply_sheet_dvm_assignments(), so a hand-built week is never
 * overwritten. Names that match nobody are filed for review rather than
 * silently dropped.
 *
 * Server-side twin of scripts/read_schedule_sheet.mjs + import_sheet_dvm.mjs.
 */

const YEAR = 2026;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** SO / VENICE / AETNA as written in the sheet -> greendogops.location.name. */
const SHEET_LOCATIONS: Record<string, string> = {
  SO: "Sherman Oaks",
  VENICE: "Venice",
  AETNA: "Van Nuys",
};

/** Sheet role row -> scheduling department; `second` picks the 2nd DVM line. */
const ROLE_TO_DEPT: Record<string, { dept: string; second: boolean }> = {
  "VET-SURGERY": { dept: "SURGERY", second: false },
  "VET-AP": { dept: "AP", second: false },
  "2nd VET-AP": { dept: "AP", second: true },
  "VET-NAD": { dept: "NAD/VE/UC", second: false },
  "2nd VET-NAD": { dept: "NAD/VE/UC", second: true },
  "VET-IM": { dept: "IM", second: false },
  "VET-EXOTICS": { dept: "EXOTICS", second: false },
  "VET-MPMV": { dept: "MPMV", second: false },
  "VET-CARDIO": { dept: "CARDIO", second: false },
};

export interface Placement {
  week: string;
  pub: string;
  date: string;
  dow: string;
  location: string;
  role: string;
  person: string;
}

/**
 * Every DVM placement in a month tab.
 *
 * Layout (verified on the September 2026 tab): one block per week, the block
 * header row has "WEEK n" in column B and a PUB / RTC flag in column C;
 * header+1 = day-of-month numbers (they wrap at month boundaries), header+2 =
 * location sub-headers. Each weekday spans 7 columns with locations at
 * +0/+2/+4, except Sunday which is a narrow stub and must not read into Monday.
 */
function extractTab(grid: string[][], tab: string): Placement[] {
  const tabMonth = MONTHS[tab.trim().toLowerCase()];
  if (!tabMonth) throw new Error(`cannot resolve a month from tab "${tab}"`);

  const cellAt = (r: number, c: number) => clean(grid[r]?.[c]);

  const blocks: number[] = [];
  grid.forEach((_, i) => {
    if (/^WEEK\s*\d/i.test(cellAt(i, 1))) blocks.push(i);
  });
  if (!blocks.length) return [];

  // Day numbers ascend across the tab and wrap at month boundaries. Week 1 can
  // start in the previous month, so seed from it and advance on every wrap.
  let curMonth = tabMonth;
  let curYear = YEAR;
  let prevDom = 0;
  for (let c = 3; c < 48; c++) {
    const dom = parseInt(cellAt(blocks[0] + 1, c), 10);
    if (!Number.isFinite(dom)) continue;
    if (dom > 20) {
      curMonth = tabMonth - 1;
      if (curMonth < 1) {
        curMonth = 12;
        curYear = YEAR - 1;
      }
    }
    break;
  }

  const out: Placement[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const head = blocks[b];
    const end = b + 1 < blocks.length ? blocks[b + 1] : grid.length;
    const pub = cellAt(head, 2);

    const days: { col: number; dow: string; date: string }[] = [];
    for (let c = 3; c < 48; c++) {
      const dow = cellAt(head, c).toUpperCase();
      if (!/^(SUN|MON|TUES|WEDNES|THURS|FRI|SATUR)DAY$/.test(dow)) continue;
      const dom = parseInt(cellAt(head + 1, c), 10);
      if (!Number.isFinite(dom)) continue;
      if (dom < prevDom) {
        curMonth += 1;
        if (curMonth > 12) {
          curMonth = 1;
          curYear += 1;
        }
      }
      prevDom = dom;
      days.push({
        col: c,
        dow,
        date: `${curYear}-${String(curMonth).padStart(2, "0")}-${String(dom).padStart(2, "0")}`,
      });
    }

    // Rows between the location header and the block's second "Role | Shift"
    // header are day notes ("Surgery Day", "LABOR DAY"); staffing starts after.
    let firstStaffRow = head + 3;
    for (let r = head + 3; r < end; r++) {
      if (/^role$/i.test(cellAt(r, 1)) && /^shift$/i.test(cellAt(r, 2))) {
        firstStaffRow = r + 1;
        break;
      }
    }

    for (let r = firstStaffRow; r < end; r++) {
      const role = cellAt(r, 1);
      if (!role || /^WEEK\s*\d/i.test(role) || role === "Role") continue;
      if (!ROLE_TO_DEPT[role]) continue;

      for (let d = 0; d < days.length; d++) {
        const day = days[d];
        const limit = (d + 1 < days.length ? days[d + 1].col : day.col + 7) - day.col - 1;
        for (let off = 0; off <= limit; off++) {
          const loc = cellAt(head + 2, day.col + off).toUpperCase();
          if (!SHEET_LOCATIONS[loc]) continue;
          const person = cellAt(r, day.col + off);
          if (!person) continue;
          out.push({
            week: cellAt(head, 1),
            pub,
            date: day.date,
            dow: day.dow,
            location: loc,
            role,
            person,
          });
        }
      }
    }
  }
  return out;
}

/** Month tabs to read: the current month plus `monthsAhead` following ones. */
function targetTabs(monthsAhead: number, available: string[]): string[] {
  const month = Number(todayLA().split("-")[1]);
  const byLower = new Map(available.map((t) => [t.trim().toLowerCase(), t]));
  const tabs: string[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const match = byLower.get(MONTH_NAMES[(month - 1 + i) % 12].toLowerCase());
    if (match) tabs.push(match);
  }
  return tabs;
}

/**
 * Read the placements without writing anything. The orchestrator calls this
 * first so the HR sync knows which name spellings the schedule relies on.
 */
export async function readSchedulePlacements(
  spreadsheetId: string,
  monthsAhead = 1,
): Promise<{ placements: Placement[]; tabs: string[] }> {
  const tabs = targetTabs(monthsAhead, await listSheetTabs(spreadsheetId));
  const placements: Placement[] = [];
  for (const tab of tabs) {
    const grid = await readSheetRange(spreadsheetId, `${tab}!A1:BE500`);
    placements.push(...extractTab(grid, tab));
  }
  return { placements, tabs };
}

/** Sunday that starts the sched_week containing `date`. */
function weekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export async function applySchedulePlacements(
  placements: Placement[],
  tabs: string[],
): Promise<SheetSyncResult> {
  const result = emptyResult();
  result.parsed = placements.length;
  result.notes = { tabs };
  if (!placements.length) return result;

  const admin = createAdminClient();
  const people = await fetchAllRows<{
    id: string;
    full_name: string | null;
    grid_name: string | null;
    status: string;
  }>(() => admin.from("person").select("id, full_name, grid_name, status").order("id"));

  const byName = new Map<string, { id: string; full_name: string | null }>();
  for (const p of people) {
    for (const n of [p.grid_name, p.full_name]) {
      const k = nameKey(n ?? "");
      if (!k) continue;
      // Active people win a name collision; grid_name is checked first because
      // it is the spelling the schedule sheet uses.
      const existing = byName.get(k);
      if (!existing || p.status === "employee" || p.status === "contractor") {
        byName.set(k, { id: p.id, full_name: p.full_name });
      }
    }
  }

  const rows: {
    week_start: string;
    work_date: string;
    day_of_week: number;
    dept: string;
    second: boolean;
    location: string;
    person_id: string;
  }[] = [];
  const unmatched = new Map<string, number>();

  for (const p of placements) {
    const map = ROLE_TO_DEPT[p.role];
    if (!map) continue;
    const person = byName.get(nameKey(p.person));
    if (!person) {
      unmatched.set(p.person, (unmatched.get(p.person) ?? 0) + 1);
      continue;
    }
    rows.push({
      week_start: weekStart(p.date),
      work_date: p.date,
      day_of_week: new Date(`${p.date}T00:00:00Z`).getUTCDay(),
      dept: map.dept,
      second: map.second,
      location: SHEET_LOCATIONS[p.location],
      person_id: person.id,
    });
  }

  for (const [name, count] of unmatched) {
    result.issues.push({
      kind: "unmatched_schedule_name",
      subject: name,
      detail: {
        placements: count,
        hint: "No person row matches this name. Add them to HR, or set the person's grid_name to the schedule spelling.",
      },
    });
  }

  if (rows.length) {
    const { data, error } = await admin.rpc("apply_sheet_dvm_assignments", { payload: rows });
    if (error) throw new Error(`apply_sheet_dvm_assignments: ${error.message}`);
    const applied = (data ?? {}) as Record<string, unknown>;
    result.inserted = Number(applied.inserted ?? 0);
    result.notes = {
      ...result.notes,
      weeks_applied: applied.weeks_applied ?? 0,
      weeks_skipped: applied.weeks_skipped ?? 0,
      skipped_week_starts: applied.skipped_week_starts ?? [],
      unmatched_names: unmatched.size,
    };
  }
  return result;
}

export async function syncStaffSchedule(
  spreadsheetId: string,
  monthsAhead = 1,
): Promise<SheetSyncResult> {
  const { placements, tabs } = await readSchedulePlacements(spreadsheetId, monthsAhead);
  return applySchedulePlacements(placements, tabs);
}
