import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { readSheetRange, listSheetTabs } from "@/lib/google/sheets";
import { clean, emptyResult, nameKey, todayLA, type SheetSyncResult, type SyncIssue } from "./common";

/**
 * Nightly pull of the "GDD Staff Schedule 2026" sheet.
 *
 * Every staffed role row in a month tab is imported, not just the doctors: the
 * sheet's role label resolves to a (department, role) pair and its shift text
 * to start/end times, which together pick the grid line the placement belongs
 * on. A row the grid has no line for gets an ad-hoc line, so the sheet can add
 * a shift (the October "Late Clinic Schedule") without a code change.
 *
 * Placements the importer writes are tagged `source = 'sheet'` and replaced
 * wholesale on every run, so anything entered in the app is left alone. Weeks
 * already published are skipped, so a hand-built week is never overwritten.
 * Names and role labels that resolve to nothing are filed for review rather
 * than silently dropped.
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

/** Punctuation- and spacing-proof key for a sheet role label. */
const labelKey = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The grid line a sheet role row belongs on. `role: null` = an unroled line. */
interface LineSpec {
  dept: string;
  role: string | null;
  label?: string;
}

/**
 * Sheet role label -> grid (department, role).
 *
 * A label that appears under more than one section ("Intern", "DVM") is
 * resolved from the section instead — see SECTION_HEADERS / SECTION_ROLES.
 */
const ROLE_MAP: Record<string, LineSpec> = {
  // Doctors. "2nd VET-*" is the department's second DVM line of the day.
  vetsurgery: { dept: "SURGERY", role: "DVM" },
  vetap: { dept: "AP", role: "DVM" },
  "2ndvetap": { dept: "AP", role: "DVM" },
  vetnad: { dept: "NAD/VE/UC", role: "DVM" },
  "2ndvetnad": { dept: "NAD/VE/UC", role: "DVM" },
  vetim: { dept: "IM", role: "DVM" },
  vetexotics: { dept: "EXOTICS", role: "DVM" },
  vetmpmv: { dept: "MPMV", role: "DVM" },
  vetcardio: { dept: "CARDIO", role: "DVM" },

  // Surgery
  surgerylead: { dept: "SURGERY", role: "Surgery Lead" },
  surgerytech: { dept: "SURGERY", role: "Surgery Tech" },
  surgerytech1: { dept: "SURGERY", role: "Surgery Tech" },
  surgerytech2: { dept: "SURGERY", role: "Surgery Tech" },

  // AP
  aplead: { dept: "AP", role: "AP Lead" },
  aptech: { dept: "AP", role: "AP Tech" },
  remoteaptech: { dept: "AP", role: "Remote AP Tech" },

  // NAD / VE / UC
  danad: { dept: "NAD/VE/UC", role: "DA - NAD" },
  datraining: { dept: "NAD/VE/UC", role: "DA - Training" },
  clinictech: { dept: "NAD/VE/UC", role: "Clinic Tech" },
  clinictechfloat: { dept: "NAD/VE/UC", role: "Clinic Tech", label: "Clinic Tech / Float" },
  clinictechmiddtfloat: {
    dept: "NAD/VE/UC",
    role: "Clinic Tech",
    label: "Clinic Tech / Mid DT Float",
  },
  clinictechda: { dept: "NAD/VE/UC", role: "Clinic Tech", label: "Clinic Tech / DA" },
  floatlead: { dept: "NAD/VE/UC", role: "Float / Lead" },
  leadtech: { dept: "NAD/VE/UC", role: "Lead Tech" },
  dentals: { dept: "NAD/VE/UC", role: "Dentals" },
  dentalstrainee: { dept: "NAD/VE/UC", role: "Dentals (trainee)" },

  // IM / Exotics / MPMV
  imtechda: { dept: "IM", role: "IM Tech/DA" },
  imtech: { dept: "IM", role: "IM Tech" },
  exotictechda: { dept: "EXOTICS", role: "Exotic Tech/DA" },
  exoticstech: { dept: "EXOTICS", role: "Exotics Tech" },
  mpmvtech: { dept: "MPMV", role: "Technician" },
  mpmvmedteam: { dept: "MPMV", role: "Technician" },

  // Front of house
  csr: { dept: "CSR", role: "CSR" },
  csrlead: { dept: "CSR", role: "CSR Lead" },
  csrtrainee: { dept: "CSR", role: "CSR trainee" },
  fac: { dept: "CSR", role: "FAC" },
  referralc: { dept: "CSR", role: "Referral C" },
  referralcmarketingclientsupport: {
    dept: "CSR",
    role: "Referral C",
    label: "Referral C / Marketing client support",
  },
  inhouseadminmarketingassit: { dept: "CSR", role: "Admin/Mrkt Asst." },

  // Remote
  rcsrmanager: { dept: "REMOTE", role: "RCSR Manager" },
  morninglead: { dept: "REMOTE", role: "Morning Lead" },
  mid: { dept: "REMOTE", role: "Mid" },
  apsx: { dept: "REMOTE", role: "AP/SX" },
  support: { dept: "REMOTE", role: "Support" },
  closer: { dept: "REMOTE", role: "Closer" },
  float: { dept: "REMOTE", role: "Float" },
  textingtidio: { dept: "REMOTE", role: "Texting / Tidio" },
  admin: { dept: "REMOTE", role: null, label: "Admin" },
  adminbackend: { dept: "REMOTE", role: null, label: "Admin/Backend" },

  // Management / admin block at the top of every week
  manager: { dept: "MANAGEMENT", role: "Manager" },
  inhouseadmin: { dept: "Admin/Asst/ Inventory", role: null, label: "In House Admin" },
  inventory: { dept: "Inventory/ Pharmacy", role: "Inventory/Pharmacy" },
  officeadmin: { dept: "Admin/Asst/ Inventory", role: null, label: "Office Admin" },
  schadmin: { dept: "Admin/Asst/ Inventory", role: null, label: "Schedule Admin" },
};

/** Rows that open a section. A VET-* row is a section header AND a DVM line. */
const SECTION_HEADERS: Record<string, string> = {
  vetsurgery: "SURGERY",
  vetap: "AP",
  vetnad: "NAD/VE/UC",
  vetim: "IM",
  vetexotics: "EXOTICS",
  vetmpmv: "MPMV",
  vetcardio: "CARDIO",
  lateclinicschedule: "NAD/VE/UC",
  remoteschdule: "REMOTE",
  remoteschedule: "REMOTE",
};

/** Labels that only mean something inside their section. */
const SECTION_ROLES: Record<string, string> = {
  dvm: "DVM",
  intern: "Intern",
  externstudent: "Extern/Student",
  exrternstudent: "Extern/Student", // the sheet's spelling
};

/** Banner rows that carry no staffing of their own. */
const HEADER_ONLY = new Set(["lateclinicschedule", "remoteschdule", "remoteschedule", "role"]);

/**
 * "9-6:30 (9)", "8-4:30p", "12pm-830pm", "9:5:30p", "9-5:30 // 8-5:30"
 * -> { start: "09:00", end: "18:30" }.
 *
 * The workbook is hand-typed, so the separator is unreliable and the meridiem
 * is usually missing. Clinic hours disambiguate it: a shift starting at 7–11
 * starts in the morning, and nothing ends before noon.
 */
export function parseShift(text: string): { start: string; end: string } | null {
  let s = clean(text).toLowerCase();
  if (!s) return null;
  s = s.split("//")[0];
  s = s.replace(/\([^)]*\)/g, "");
  s = s.replace(/-\s*:/g, "-").replace(/:\s*-/g, "-");
  s = clean(s);
  if (!s) return null;

  let parts = s.split(/\s*(?:-|–|—|\bto\b)\s*/).filter(Boolean);
  if (parts.length < 2) {
    // "9:5:30p" / "10:6:30p" are "9-5:30p" / "10-6:30p" with a typo'd dash.
    const typo = /^(\d{1,2}):(\d{1,2}:\d{2}\s*[ap]m?)$/.exec(s);
    if (!typo) return null;
    parts = [typo[1], typo[2]];
  }

  const start = parseClock(parts[0], "start");
  const end = parseClock(parts[1], "end");
  return start && end ? { start, end } : null;
}

function parseClock(raw: string, side: "start" | "end"): string | null {
  const s = clean(raw).replace(/\s+/g, "");
  // "830pm" — a compact time is only unambiguous when the meridiem is written.
  let m = /^(\d{1,2})(\d{2})(am|pm|a|p)$/.exec(s);
  if (!m) m = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;

  let hour = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3];
  if (hour > 23 || min > 59) return null;

  if (mer?.startsWith("p")) {
    if (hour < 12) hour += 12;
  } else if (mer?.startsWith("a")) {
    if (hour === 12) hour = 0;
  } else if (side === "start") {
    if (hour < 7) hour += 12; // a 1–6 start is the afternoon
  } else if (hour < 12) {
    hour += 12; // nothing here ends before noon
  }

  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface Placement {
  week: string;
  pub: string;
  date: string;
  dow: string;
  location: string;
  /** Column B exactly as written in the sheet. */
  role: string;
  /** Column C exactly as written in the sheet. */
  shift: string;
  /** Identifies the sheet row, so one row maps onto exactly one grid line. */
  rowKey: string;
  /** Position of the row inside its week block; orders the grid lines. */
  order: number;
  person: string;
}

/**
 * Every placement in a month tab.
 *
 * Layout (verified on the September and October 2026 tabs): one block per week,
 * the block header row has "WEEK n" in column B and a PUB / RTC flag in column
 * C; header+1 = day-of-month numbers (they wrap at month boundaries), header+2
 * = location sub-headers. Each weekday spans 7 columns with locations at
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
      if (!role || /^WEEK\s*\d/i.test(role)) continue;

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
            shift: cellAt(r, 2),
            rowKey: `${tab}#${r - head}`,
            order: r - head,
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
    const grid = await readSheetRange(spreadsheetId, `${tab}!A1:BE600`);
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

/** Resolve a sheet role row against the section it sits under. */
function resolveRole(
  label: string,
  section: string | null,
): { spec: LineSpec | null; section: string | null } | null {
  const key = labelKey(label);
  const header = SECTION_HEADERS[key];
  if (HEADER_ONLY.has(key)) return header ? { spec: null, section: header } : null;

  const sectionRole = SECTION_ROLES[key];
  if (sectionRole) {
    if (!section) return null;
    return { spec: { dept: section, role: sectionRole }, section };
  }

  const mapped = ROLE_MAP[key];
  if (!mapped) return null;
  // An explicit mapping also moves the section, which is how the unheaded CSR
  // block after VET-CARDIO gets picked up.
  return { spec: mapped, section: header ?? mapped.dept };
}

/** One sheet role row, resolved to the grid line it needs. */
interface LineDraft {
  rowKey: string;
  order: number;
  dept: string;
  role: string | null;
  label: string | null;
  start: string | null;
  end: string | null;
}

interface WeekLineRow {
  id: string;
  department_id: string;
  role_id: string | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number;
}

const sameTime = (a: string | null, b: string | null): boolean =>
  !!a && !!b && a.slice(0, 5) === b.slice(0, 5);

/** Minutes between two "HH:MM" times; Infinity when either is unknown. */
function timeGap(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.abs(mins(a) - mins(b));
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

  const [people, deptRes, roleRes, locRes] = await Promise.all([
    fetchAllRows<{ id: string; full_name: string | null; grid_name: string | null; status: string }>(
      () => admin.from("person").select("id, full_name, grid_name, status").order("id"),
    ),
    admin.from("sched_department").select("id, name"),
    admin.from("sched_role").select("id, name, department_id"),
    admin.from("location").select("id, name"),
  ]);

  const deptByName = new Map(
    ((deptRes.data ?? []) as { id: string; name: string }[]).map((d) => [d.name, d.id]),
  );
  // A department can hold two role rows with the same name (SURGERY has two
  // "Surgery Tech"), so lines are matched on the role NAME, not its id.
  const roleIdByKey = new Map<string, string>();
  const roleNameById = new Map<string, string>();
  for (const r of (roleRes.data ?? []) as { id: string; name: string; department_id: string }[]) {
    roleNameById.set(r.id, r.name);
    const key = `${r.department_id}|${r.name}`;
    if (!roleIdByKey.has(key)) roleIdByKey.set(key, r.id);
  }
  const locByName = new Map(
    ((locRes.data ?? []) as { id: string; name: string }[]).map((l) => [l.name, l.id]),
  );

  const byName = new Map<string, string>();
  for (const p of people) {
    for (const n of [p.grid_name, p.full_name]) {
      const k = nameKey(n ?? "");
      if (!k) continue;
      // Active people win a name collision; grid_name is checked first because
      // it is the spelling the schedule sheet uses.
      if (!byName.has(k) || p.status === "employee" || p.status === "contractor") {
        byName.set(k, p.id);
      }
    }
  }

  interface Resolved {
    weekStart: string;
    workDate: string;
    dayOfWeek: number;
    rowKey: string;
    locationId: string;
    personId: string;
  }

  const drafts = new Map<string, LineDraft>();
  const resolved: Resolved[] = [];
  const unmatchedNames = new Map<string, number>();
  const unmappedRoles = new Map<string, number>();
  const unknownDepts = new Map<string, number>();

  // Placements come out of the sheet top to bottom, so the section header a
  // row sits under is whatever was seen last.
  let section: string | null = null;
  for (const p of placements) {
    const hit = resolveRole(p.role, section);
    if (!hit) {
      unmappedRoles.set(p.role, (unmappedRoles.get(p.role) ?? 0) + 1);
      continue;
    }
    section = hit.section;
    if (!hit.spec) continue;

    const deptId = deptByName.get(hit.spec.dept);
    if (!deptId) {
      unknownDepts.set(hit.spec.dept, (unknownDepts.get(hit.spec.dept) ?? 0) + 1);
      continue;
    }
    const locationId = locByName.get(SHEET_LOCATIONS[p.location]);
    if (!locationId) continue;

    const personId = byName.get(nameKey(p.person));
    if (!personId) {
      unmatchedNames.set(p.person, (unmatchedNames.get(p.person) ?? 0) + 1);
      continue;
    }

    if (!drafts.has(p.rowKey)) {
      const shift = parseShift(p.shift);
      drafts.set(p.rowKey, {
        rowKey: p.rowKey,
        order: p.order,
        dept: hit.spec.dept,
        role: hit.spec.role,
        label: hit.spec.label ?? null,
        start: shift?.start ?? null,
        end: shift?.end ?? null,
      });
    }

    resolved.push({
      weekStart: weekStart(p.date),
      workDate: p.date,
      dayOfWeek: new Date(`${p.date}T00:00:00Z`).getUTCDay(),
      rowKey: p.rowKey,
      locationId,
      personId,
    });
  }

  const weekStarts = [...new Set(resolved.map((r) => r.weekStart))].sort();
  const { data: weekRows } = await admin
    .from("sched_week")
    .select("id, week_start, status, is_template")
    .in("week_start", weekStarts);
  const weeks = new Map(
    (
      (weekRows ?? []) as {
        id: string;
        week_start: string;
        status: string;
        is_template: boolean;
      }[]
    )
      .filter((w) => !w.is_template)
      .map((w) => [w.week_start, w]),
  );

  let inserted = 0;
  let replaced = 0;
  let adopted = 0;
  let linesCreated = 0;
  let stacked = 0;
  let applied = 0;
  const notInTemplate = new Map<string, number>();
  const skippedWeeks: string[] = [];
  const missingWeeks: string[] = [];

  for (const ws of weekStarts) {
    const week = weeks.get(ws);
    if (!week) {
      missingWeeks.push(ws);
      continue;
    }
    if (week.status === "published") {
      skippedWeeks.push(ws);
      continue;
    }

    const rows = resolved.filter((r) => r.weekStart === ws);
    const weekDrafts = [...new Set(rows.map((r) => r.rowKey))]
      .map((k) => drafts.get(k)!)
      .sort((a, b) => a.order - b.order);

    const { data: lineData } = await admin
      .from("sched_week_line")
      .select("id, department_id, role_id, label, start_time, end_time, sort_order")
      .eq("week_id", week.id);
    const lines = (lineData ?? []) as WeekLineRow[];

    // The Dept/Shift Template owns which lines a week has, so a sheet row is
    // placed on the closest line that already exists. A line is only created
    // when the department has nothing for that role at all — otherwise the
    // grid fills up with near-duplicate shifts.
    const groups = new Map<string, LineDraft[]>();
    for (const d of weekDrafts) {
      const deptId = deptByName.get(d.dept)!;
      const key = `${deptId}|${d.role ?? ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }

    const lineByRowKey = new Map<string, string>();
    const taken = new Set<string>();
    const pending: LineDraft[] = [];

    for (const [key, specs] of groups) {
      const [deptId, roleName] = key.split("|");
      let pool = lines.filter(
        (l) =>
          l.department_id === deptId &&
          (roleName ? roleNameById.get(l.role_id ?? "") === roleName : !l.role_id),
      );
      // Departments whose lines carry no role at all still own their rows.
      if (!pool.length && roleName) {
        pool = lines.filter((l) => l.department_id === deptId && !l.role_id);
      }
      if (!pool.length) {
        pending.push(...specs);
        continue;
      }

      const claim = (d: LineDraft, l: WeekLineRow) => {
        taken.add(l.id);
        lineByRowKey.set(d.rowKey, l.id);
      };
      const free = () => pool.filter((l) => !taken.has(l.id));
      const nearest = (d: LineDraft, from: WeekLineRow[]) =>
        from.reduce((best, l) =>
          timeGap(l.start_time, d.start) < timeGap(best.start_time, d.start) ? l : best,
        );

      const left: LineDraft[] = [];
      for (const d of specs) {
        const byLabel = d.label
          ? free().find((l) => l.label && labelKey(l.label) === labelKey(d.label!))
          : undefined;
        const exact = free().find(
          (l) => sameTime(l.start_time, d.start) && sameTime(l.end_time, d.end),
        );
        const hit = byLabel ?? exact;
        if (hit) claim(d, hit);
        else left.push(d);
      }
      for (const d of left) {
        const open = free();
        if (open.length) {
          claim(d, nearest(d, open));
        } else {
          // Out of lines: share the closest one rather than inventing a shift.
          lineByRowKey.set(d.rowKey, nearest(d, pool).id);
          stacked += 1;
        }
      }
    }

    if (pending.length) {
      const nextSort = new Map<string, number>();
      for (const l of lines) {
        if (l.sort_order >= (nextSort.get(l.department_id) ?? 0)) {
          nextSort.set(l.department_id, l.sort_order + 1);
        }
      }
      // Several sheet rows can want the same missing shift; build one line for
      // each distinct one and let the rest share it.
      const distinct = new Map<string, LineDraft[]>();
      for (const d of pending) {
        const key = `${d.dept}|${d.role ?? ""}|${d.label ?? ""}|${d.start ?? ""}|${d.end ?? ""}`;
        if (!distinct.has(key)) distinct.set(key, []);
        distinct.get(key)!.push(d);
      }
      const want = [...distinct.values()];
      const inserts = want.map(([d]) => {
        const deptId = deptByName.get(d.dept)!;
        const sort = nextSort.get(deptId) ?? 0;
        nextSort.set(deptId, sort + 1);
        const what = `${d.dept} / ${d.role ?? d.label ?? "unroled"}`;
        notInTemplate.set(what, (notInTemplate.get(what) ?? 0) + 1);
        return {
          week_id: week.id,
          department_id: deptId,
          role_id: d.role ? roleIdByKey.get(`${deptId}|${d.role}`) ?? null : null,
          label: d.label,
          start_time: d.start,
          end_time: d.end,
          sort_order: sort,
          is_adhoc: true,
        };
      });
      const { data: made, error } = await admin
        .from("sched_week_line")
        .insert(inserts)
        .select("id");
      if (error) throw new Error(`create week lines (${ws}): ${error.message}`);
      const ids = ((made ?? []) as { id: string }[]).map((m) => m.id);
      want.forEach((sharing, i) => {
        if (!ids[i]) return;
        for (const d of sharing) lineByRowKey.set(d.rowKey, ids[i]);
      });
      linesCreated += ids.length;
    }

    const { data: gone, error: delErr } = await admin
      .from("sched_assignment")
      .delete()
      .eq("week_id", week.id)
      .eq("source", "sheet")
      .select("id");
    if (delErr) throw new Error(`clear sheet assignments (${ws}): ${delErr.message}`);
    replaced += (gone ?? []).length;

    // Whatever is left was placed by hand or by the one-off imports that ran
    // before this sync existed. A row the sheet also asks for is the same
    // placement, so adopt it instead of stacking a second name in the cell.
    const { data: keptData } = await admin
      .from("sched_assignment")
      .select("id, line_id, location_id, day_of_week, person_id")
      .eq("week_id", week.id);
    const kept = new Map(
      (
        (keptData ?? []) as {
          id: string;
          line_id: string;
          location_id: string;
          day_of_week: number;
          person_id: string;
        }[]
      ).map((a) => [`${a.line_id}|${a.location_id}|${a.day_of_week}|${a.person_id}`, a.id]),
    );

    // One person stands on one line, at one location, on one day.
    const seen = new Set<string>();
    const adopt: string[] = [];
    const payload: Record<string, unknown>[] = [];
    for (const r of rows) {
      const lineId = lineByRowKey.get(r.rowKey);
      if (!lineId) continue;
      const cellKey = `${lineId}|${r.locationId}|${r.dayOfWeek}|${r.personId}`;
      if (seen.has(cellKey)) continue;
      seen.add(cellKey);

      const existing = kept.get(cellKey);
      if (existing) {
        adopt.push(existing);
        continue;
      }
      payload.push({
        week_id: week.id,
        line_id: lineId,
        location_id: r.locationId,
        person_id: r.personId,
        day_of_week: r.dayOfWeek,
        work_date: r.workDate,
        source: "sheet",
      });
    }

    for (let i = 0; i < adopt.length; i += 500) {
      const { error } = await admin
        .from("sched_assignment")
        .update({ source: "sheet" })
        .in("id", adopt.slice(i, i + 500));
      if (error) throw new Error(`adopt assignments (${ws}): ${error.message}`);
    }
    adopted += adopt.length;

    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await admin.from("sched_assignment").insert(payload.slice(i, i + 500));
      if (error) throw new Error(`insert assignments (${ws}): ${error.message}`);
    }
    inserted += payload.length;
    applied += 1;
  }

  const issues: SyncIssue[] = [];
  for (const [name, count] of unmatchedNames) {
    issues.push({
      kind: "unmatched_schedule_name",
      subject: name,
      detail: {
        placements: count,
        hint: "No person row matches this name. Add them to HR, or set the person's grid_name to the schedule spelling.",
      },
    });
  }
  for (const [label, count] of unmappedRoles) {
    issues.push({
      kind: "unmapped_schedule_role",
      subject: label,
      detail: {
        placements: count,
        hint: "This role row has no department/role mapping yet, so its shifts are not imported.",
      },
    });
  }
  for (const [dept, count] of unknownDepts) {
    issues.push({
      kind: "unknown_schedule_department",
      subject: dept,
      detail: { placements: count, hint: "No sched_department is named this." },
    });
  }
  for (const [what, count] of notInTemplate) {
    issues.push({
      kind: "role_missing_from_template",
      subject: what,
      detail: {
        weeks: count,
        hint: "The sheet staffs this role but the Dept/Shift Template has no line for it, so the importer had to add one. Add it in Schedule > Set Up to keep the grid matching the template.",
      },
    });
  }
  for (const ws of missingWeeks) {
    issues.push({
      kind: "missing_schedule_week",
      subject: ws,
      detail: { hint: "The sheet staffs this week but it has not been opened in the grid yet." },
    });
  }
  result.issues = issues;

  result.inserted = inserted;
  result.notes = {
    ...result.notes,
    weeks_applied: applied,
    weeks_skipped: skippedWeeks.length,
    skipped_week_starts: skippedWeeks,
    missing_week_starts: missingWeeks,
    lines_created: linesCreated,
    lines_shared: stacked,
    roles_missing_from_template: [...notInTemplate.keys()],
    replaced,
    adopted,
    unmatched_names: unmatchedNames.size,
    unmapped_roles: [...unmappedRoles.keys()],
  };
  return result;
}

export async function syncStaffSchedule(
  spreadsheetId: string,
  monthsAhead = 1,
): Promise<SheetSyncResult> {
  const { placements, tabs } = await readSchedulePlacements(spreadsheetId, monthsAhead);
  return applySchedulePlacements(placements, tabs);
}
