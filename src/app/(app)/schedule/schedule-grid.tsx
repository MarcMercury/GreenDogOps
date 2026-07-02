"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SetupData, WeekData } from "./data";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  DAY_LABELS,
  DAY_SHORT,
  MARKABLE_ATTENDANCE,
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  buildWeekTimeOff,
  dateForDay,
  effectiveAttendance,
  formatWeekRange,
  gridName,
  timeRange,
  type AttendanceStatus,
  type SchedAssignment,
  type SchedDepartment,
  type SchedEvent,
  type SchedPerson,
  type SchedRole,
  type SchedWeek,
  type SchedWeekLine,
  type ScheduleLocation,
  type WeekTimeOff,
} from "@/lib/schedule/types";
import { WeekPicker } from "./week-picker";import {
  assignPerson,
  removeAssignment,
  moveAssignment,
  markAttendance,
  toggleClosure,
  setEvent,
  setWeekStatus,
  addWeekLine,
  updateWeekLine,
  removeWeekLine,
  saveDepartment,
  deleteDepartment,
  applyDefaultTemplate,
} from "./actions";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

interface CellKey {
  lineId: string;
  locationId: string;
  day: number;
}

/** Parse an "HH:MM[:SS]" time into minutes since midnight, or null. */
function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * 12-hour clock label with AM/PM ("8:30 AM", "5:00 PM"), matching the format
 * When I Work uses in its shift entry form. Returns "" for missing times.
 */
function formatClock(t: string | null): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "YYYY-MM-DD" → "M/D/YYYY" for spreadsheet-friendly CSV output. */
function csvDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Quote/escape a single CSV cell per RFC 4180. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Decide whether two same-day assignments for the same person collide — i.e.
 * the person would have to be in two places at once. The same shift line is
 * always a collision (an exact duplicate). Otherwise the lines' time windows
 * are compared; when times are missing we only flag when the locations differ.
 */
function assignmentsOverlap(
  a: SchedAssignment,
  b: SchedAssignment,
  lineById: Map<string, SchedWeekLine>,
): boolean {
  if (a.line_id === b.line_id) return true;
  const la = lineById.get(a.line_id);
  const lb = lineById.get(b.line_id);
  const s1 = timeToMinutes(la?.start_time);
  const e1 = timeToMinutes(la?.end_time);
  const s2 = timeToMinutes(lb?.start_time);
  const e2 = timeToMinutes(lb?.end_time);
  if (s1 === null || e1 === null || s2 === null || e2 === null) {
    // Times unknown: flag only cross-location double-bookings (can't be two
    // places at once); same-location split shifts are left alone.
    return a.location_id !== b.location_id;
  }
  // Half-open interval overlap test.
  return s1 < e2 && s2 < e1;
}

export function ScheduleGrid({
  weeks,
  weekData,
  setup,
  timeOff,
  canEdit = false,
}: {
  weeks: SchedWeek[];
  weekData: WeekData;
  setup: SetupData;
  timeOff: { person_id: string; status: string; start_date: string; end_date: string }[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const { week, lines, weekLocations, closures, events, assignments } = weekData;
  const isPublished = week.status === "published";
  // Locations available + which are toggled on.
  const planLocationIds = useMemo(
    () => new Set(weekLocations.map((w) => w.location_id)),
    [weekLocations],
  );
  const availableLocations = useMemo(
    () =>
      setup.locations
        .filter((l) => l.is_active || planLocationIds.has(l.id))
        .sort((a, b) => a.sort_order - b.sort_order),
    [setup.locations, planLocationIds],
  );
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    const base = planLocationIds.size
      ? availableLocations.filter((l) => planLocationIds.has(l.id))
      : availableLocations.slice(0, 1);
    // MPMV is hidden from the default view (still available to toggle on).
    const init = base.filter(
      (l) => (l.short_code ?? l.name).toUpperCase() !== "MPMV",
    );
    return new Set(init.map((l) => l.id));
  });
  const shownLocations = availableLocations.filter((l) => enabled.has(l.id));

  // Lookups -----------------------------------------------------------------
  const personById = useMemo(
    () => new Map(setup.people.map((p) => [p.id, p])),
    [setup.people],
  );
  const roleName = (id: string | null) =>
    id ? setup.roles.find((r) => r.id === id)?.name ?? null : null;

  const membersByRole = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const mem of setup.members) {
      if (!m.has(mem.role_id)) m.set(mem.role_id, new Set());
      m.get(mem.role_id)!.add(mem.person_id);
    }
    return m;
  }, [setup.members]);

  // Active assignments only (removed_post_publish excluded for counts/cells).
  const activeAssignments = useMemo(
    () => assignments.filter((a) => !a.removed_post_publish),
    [assignments],
  );

  // Per-person, per-day time-off overlay for this week.
  const weekTimeOff = useMemo(
    () => buildWeekTimeOff(timeOff, week.week_start),
    [timeOff, week.week_start],
  );

  const weeklyCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activeAssignments)
      m.set(a.person_id, (m.get(a.person_id) ?? 0) + 1);
    return m;
  }, [activeAssignments]);

  const scheduledByDay = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const a of activeAssignments) {
      if (!m.has(a.day_of_week)) m.set(a.day_of_week, new Set());
      m.get(a.day_of_week)!.add(a.person_id);
    }
    return m;
  }, [activeAssignments]);

  const cellMap = useMemo(() => {
    const m = new Map<string, SchedAssignment[]>();
    for (const a of assignments) {
      const k = `${a.line_id}|${a.location_id}|${a.day_of_week}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [assignments]);

  // Double-booking detection: a person cannot be in two overlapping shifts on
  // the same day. We flag (not block) the offending assignments so the grid can
  // highlight them in red with a reason in the tooltip.
  const conflictReasons = useMemo(() => {
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const locLabel = (id: string) => {
      const l = setup.locations.find((x) => x.id === id);
      return l ? l.short_code ?? l.name : "another location";
    };
    const reasons = new Map<string, string[]>();
    const byPersonDay = new Map<string, SchedAssignment[]>();
    for (const a of activeAssignments) {
      const key = `${a.person_id}|${a.day_of_week}`;
      if (!byPersonDay.has(key)) byPersonDay.set(key, []);
      byPersonDay.get(key)!.push(a);
    }
    const note = (a: SchedAssignment, other: SchedAssignment) => {
      const line = lineById.get(other.line_id);
      const time = timeRange(line?.start_time ?? null, line?.end_time ?? null);
      const where = locLabel(other.location_id);
      const label = [where, time].filter(Boolean).join(" ");
      const list = reasons.get(a.id) ?? [];
      list.push(label);
      reasons.set(a.id, list);
    };
    for (const list of byPersonDay.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (assignmentsOverlap(list[i], list[j], lineById)) {
            note(list[i], list[j]);
            note(list[j], list[i]);
          }
        }
      }
    }
    return reasons;
  }, [activeAssignments, lines, setup.locations]);

  const closureSet = useMemo(
    () => new Set(closures.map((c) => `${c.location_id}|${c.day_of_week}`)),
    [closures],
  );

  const eventMap = useMemo(() => {
    const m = new Map<string, SchedEvent>();
    for (const e of events) m.set(`${e.location_id}|${e.day_of_week}`, e);
    return m;
  }, [events]);

  // Lines grouped by department, in order.
  const grouped = useMemo(() => {
    const byDept = new Map<string, SchedWeekLine[]>();
    for (const l of lines) {
      if (!byDept.has(l.department_id)) byDept.set(l.department_id, []);
      byDept.get(l.department_id)!.push(l);
    }
    const order = [...setup.departments]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((d) => byDept.has(d.id));
    return order.map((d) => ({
      dept: d,
      lines: (byDept.get(d.id) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    }));
  }, [lines, setup.departments]);

  // Per-employee shift list for the "Export per employee" printout: every
  // active assignment grouped by person, then sorted by date and start time so
  // each printed page reads top-to-bottom through the week.
  const perEmployee = useMemo(() => {
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const locationById = new Map(setup.locations.map((l) => [l.id, l]));
    const roleById = new Map(setup.roles.map((r) => [r.id, r]));
    type EmpShift = {
      day: number;
      date: string;
      start: string | null;
      end: string | null;
      location: string;
      position: string;
    };
    const byPerson = new Map<
      string,
      { person: SchedPerson; shifts: EmpShift[] }
    >();
    for (const a of assignments) {
      if (a.removed_post_publish) continue;
      const person = personById.get(a.person_id);
      if (!person) continue;
      const line = lineById.get(a.line_id);
      const loc = locationById.get(a.location_id);
      const role = line?.role_id ? roleById.get(line.role_id) : null;
      const entry = byPerson.get(a.person_id) ?? { person, shifts: [] };
      entry.shifts.push({
        day: a.day_of_week,
        date: a.work_date || dateForDay(week.week_start, a.day_of_week),
        start: line?.start_time ?? null,
        end: line?.end_time ?? null,
        location: loc ? loc.name : "—",
        position: line?.label || role?.name || "Shift",
      });
      byPerson.set(a.person_id, entry);
    }
    const list = [...byPerson.values()];
    for (const e of list) {
      e.shifts.sort((x, y) =>
        x.date === y.date
          ? (x.start ?? "").localeCompare(y.start ?? "")
          : x.date.localeCompare(y.date),
      );
    }
    list.sort((a, b) => gridName(a.person).localeCompare(gridName(b.person)));
    return list;
  }, [assignments, lines, personById, setup.locations, setup.roles, week.week_start]);

  // Build a When I Work-friendly CSV and trigger a download. When I Work has no
  // shift-import file format, so the admin re-keys each shift by hand: they pick
  // a Location, then a Week, then work employee-by-employee. This export mirrors
  // that order — rows are grouped by Location (matching the location they select
  // in When I Work) and, within each location, by Employee — so the admin can
  // read straight down one location block, one employee at a time. Blank rows
  // separate each location (major break) and each employee (minor break) so the
  // transcription unit — one person's week at one site — is visually obvious.
  const downloadWiwCsv = () => {
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const roleById = new Map(setup.roles.map((r) => [r.id, r]));
    // Location display order (same order the grid and When I Work list them in).
    const locSort = new Map(setup.locations.map((l) => [l.id, l.sort_order]));
    const locName = new Map(setup.locations.map((l) => [l.id, l.name]));

    type Row = {
      locId: string;
      locName: string;
      locSort: number;
      personId: string;
      personName: string;
      day: number;
      date: string;
      start: string | null;
      end: string | null;
      position: string;
    };
    const flat: Row[] = [];
    for (const a of assignments) {
      if (a.removed_post_publish) continue;
      const person = personById.get(a.person_id);
      if (!person) continue;
      const line = lineById.get(a.line_id);
      const role = line?.role_id ? roleById.get(line.role_id) : null;
      flat.push({
        locId: a.location_id,
        locName: locName.get(a.location_id) ?? "—",
        locSort: locSort.get(a.location_id) ?? Number.MAX_SAFE_INTEGER,
        personId: a.person_id,
        personName: gridName(person),
        day: a.day_of_week,
        date: a.work_date || dateForDay(week.week_start, a.day_of_week),
        start: line?.start_time ?? null,
        end: line?.end_time ?? null,
        position: line?.label || role?.name || "Shift",
      });
    }
    // Location order → employee name → date → start time.
    flat.sort(
      (x, y) =>
        x.locSort - y.locSort ||
        x.locName.localeCompare(y.locName) ||
        x.personName.localeCompare(y.personName) ||
        x.date.localeCompare(y.date) ||
        (x.start ?? "").localeCompare(y.start ?? ""),
    );

    const header = [
      "Location",
      "Employee",
      "Day",
      "Date",
      "Start Time",
      "End Time",
      "Position",
    ];
    const rows: string[][] = [header];
    let prevLocId: string | null = null;
    let prevPersonId: string | null = null;
    for (const r of flat) {
      if (prevLocId !== null && r.locId !== prevLocId) {
        // Major break between locations (two blank rows).
        rows.push([], []);
      } else if (prevPersonId !== null && r.personId !== prevPersonId) {
        // Minor break between employees within a location.
        rows.push([]);
      }
      rows.push([
        r.locName,
        r.personName,
        DAY_LABELS[r.day],
        csvDate(r.date),
        formatClock(r.start),
        formatClock(r.end),
        r.position,
      ]);
      prevLocId = r.locId;
      prevPersonId = r.personId;
    }

    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule-${week.week_start}-wheniwork.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // UI state
  const [picker, setPicker] = useState<CellKey | null>(null);
  const [attMenu, setAttMenu] = useState<string | null>(null);
  const [lineModal, setLineModal] = useState<{
    line: SchedWeekLine | null;
    deptId?: string;
  } | null>(null);
  const [deptModal, setDeptModal] = useState<{
    dept: SchedDepartment | null;
  } | null>(null);

  const [eventModal, setEventModal] = useState<{
    locationId: string;
    day: number;
    title: string;
  } | null>(null);

  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(
    () => new Set(),
  );

  // Printing: `null` = nothing pending; "grid" prints the schedule as-is,
  // "employee" swaps in the per-employee pages. The effect fires the browser
  // print dialog once the DOM reflects the chosen mode, then resets.
  const [printMode, setPrintMode] = useState<"grid" | "employee" | null>(null);
  useEffect(() => {
    if (!printMode) return;
    const reset = () => setPrintMode(null);
    window.addEventListener("afterprint", reset, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", reset);
  }, [printMode]);

  const toggleDept = (id: string) =>
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const colCount = shownLocations.length;

  // Synchronized horizontal scrollbars (top + bottom) for the grid table.
  const topScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    const grid = gridScrollRef.current;
    if (!grid) return;
    const update = () => setScrollWidth(grid.scrollWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    const table = grid.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [shownLocations.length, week.id]);

  const syncFromTop = () => {
    if (topScrollRef.current && gridScrollRef.current) {
      gridScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };
  const syncFromGrid = () => {
    if (topScrollRef.current && gridScrollRef.current) {
      topScrollRef.current.scrollLeft = gridScrollRef.current.scrollLeft;
    }
  };

  return (
    <div
      className={`space-y-3 ${
        printMode === "employee" ? "sched-print-employee" : "sched-print-grid"
      }`}
    >
      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You have read-only access to the schedule. Changes are disabled.
        </div>
      )}
      <Toolbar
        week={week}
        weeks={weeks}
        availableLocations={availableLocations}
        enabled={enabled}
        setEnabled={setEnabled}
        onPrintGrid={() => setPrintMode("grid")}
        onPrintEmployee={() => setPrintMode("employee")}
        onExportCsv={downloadWiwCsv}
        onStatus={(s) =>
          start(async () => {
            await setWeekStatus(week.id, s);
            router.refresh();
          })
        }
      />

      <div
        ref={topScrollRef}
        onScroll={syncFromTop}
        className="sticky top-0 z-30 overflow-x-scroll rounded-t-lg border border-slate-200 bg-white/95 backdrop-blur print:hidden"
        aria-hidden
      >
        <div style={{ width: scrollWidth, height: 12 }} />
      </div>

      <div
        ref={gridScrollRef}
        onScroll={syncFromGrid}
        className="sched-grid-print overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm print:overflow-visible print:border-0 print:shadow-none"
      >
        <table
          className="min-w-full border-collapse text-xs"
          style={{ zoom: 0.85 }}
        >
          <thead>
            <tr>
              <th
                rowSpan={3}
                className="sticky left-0 z-20 w-px whitespace-nowrap border-b border-r border-slate-300 bg-slate-50 px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Shift
              </th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  colSpan={Math.max(colCount, 1)}
                  className="border-b border-l-2 border-b-slate-300 border-l-slate-400 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
                >
                  {DAY_SHORT[d]}{" "}
                  <span className="font-normal text-slate-400">
                    {new Date(
                      `${dateForDay(week.week_start, d)}T00:00:00`,
                    ).getDate()}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {DAYS.map((d) =>
                shownLocations.length === 0 ? (
                  <th
                    key={d}
                    className="border-b border-l-2 border-b-slate-200 border-l-slate-400 bg-slate-50 px-2 py-1"
                  />
                ) : (
                  shownLocations.map((loc, locIdx) => {
                    const dayStart = locIdx === 0;
                    const ev = eventMap.get(`${loc.id}|${d}`);
                    const evtClosed = closureSet.has(`${loc.id}|${d}`);
                    return (
                      <th
                        key={`evt-${d}-${loc.id}`}
                        className={`border-b border-b-slate-200 bg-slate-50 p-0.5 align-middle ${
                          dayStart
                            ? "border-l-2 border-l-slate-400"
                            : "border-l border-l-slate-200"
                        }`}
                        style={
                          evtClosed
                            ? { width: 18, minWidth: 18, maxWidth: 18 }
                            : { width: 128, minWidth: 128, maxWidth: 128 }
                        }
                      >
                        <button
                          onClick={() =>
                            setEventModal({
                              locationId: loc.id,
                              day: d,
                              title: ev?.title ?? "",
                            })
                          }
                          title={
                            ev
                              ? `Edit event: ${ev.title}`
                              : "Add an event for this location/day"
                          }
                          className={`flex min-h-[18px] w-full items-center justify-center truncate rounded px-1 py-0.5 text-center text-[9px] font-semibold leading-tight transition ${
                            ev
                              ? "text-white"
                              : "text-transparent hover:text-slate-400 hover:bg-slate-100 print:hidden"
                          }`}
                          style={
                            ev
                              ? { backgroundColor: loc.color ?? "#64748b" }
                              : undefined
                          }
                        >
                          {ev ? ev.title : "+ event"}
                        </button>
                      </th>
                    );
                  })
                ),
              )}
            </tr>
            <tr>
              {DAYS.map((d) =>
                shownLocations.length === 0 ? (
                  <th
                    key={d}
                    className="border-b border-l-2 border-b-slate-300 border-l-slate-400 bg-slate-50 px-2 py-1 text-center text-[10px] text-slate-400"
                  >
                    —
                  </th>
                ) : (
                  shownLocations.map((loc, locIdx) => {
                    const closed = closureSet.has(`${loc.id}|${d}`);
                    const dayStart = locIdx === 0;
                    return (
                      <th
                        key={`${d}-${loc.id}`}
                        className={`border-b border-b-slate-300 bg-slate-50 px-1.5 py-1 text-center ${
                          dayStart
                            ? "border-l-2 border-l-slate-400"
                            : "border-l border-l-slate-300"
                        }`}
                        style={{
                          width: closed ? 18 : 128,
                          minWidth: closed ? 18 : 128,
                          maxWidth: closed ? 18 : 128,
                          borderTop: `2px solid ${loc.color ?? "#94a3b8"}`,
                        }}
                      >
                        <button
                          onClick={() =>
                            start(async () => {
                              await toggleClosure(week.id, loc.id, d);
                              router.refresh();
                            })
                          }
                          title={closed ? "Re-open location" : "Close location"}
                          className={
                            closed
                              ? "mx-auto block max-h-[64px] overflow-hidden text-[9px] font-semibold text-slate-400 line-through [writing-mode:vertical-rl]"
                              : "block w-full truncate text-[10px] font-semibold text-slate-500 hover:text-emerald-600"
                          }
                        >
                          {loc.short_code ?? loc.name}
                        </button>
                      </th>
                    );
                  })
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ dept, lines: deptLines }) => (
              <DeptSection
                key={dept.id}
                dept={dept}
                span={1 + DAYS.length * Math.max(colCount, 1)}
                collapsed={collapsedDepts.has(dept.id)}
                lineCount={deptLines.length}
                onToggle={() => toggleDept(dept.id)}
                onAddLine={() =>
                  setLineModal({ line: null, deptId: dept.id })
                }
                onEditDept={() => setDeptModal({ dept })}
              >
                {collapsedDepts.has(dept.id)
                  ? null
                  : deptLines.map((line) => (
                  <tr key={line.id} className="group/line hover:bg-slate-50/40">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r border-slate-300 bg-white px-3 py-1.5 text-left align-top"
                      style={{ borderLeft: `3px solid ${dept.color}` }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <span className="block whitespace-nowrap text-[12px] font-medium text-slate-800">
                            {line.label || roleName(line.role_id) || "Shift"}
                            {line.is_adhoc && (
                              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
                                +
                              </span>
                            )}
                          </span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {timeRange(line.start_time, line.end_time)}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover/line:opacity-100 print:hidden">
                          <button
                            onClick={() => setLineModal({ line })}
                            title="Edit shift line"
                            className="text-[11px] text-slate-400 hover:text-emerald-600"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() =>
                              start(async () => {
                                await removeWeekLine(line.id);
                                router.refresh();
                              })
                            }
                            title="Delete this row"
                            className="text-[11px] text-slate-400 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </th>
                    {DAYS.map((d) =>
                      shownLocations.length === 0 ? (
                        <td
                          key={d}
                          className="border-b border-b-slate-200 border-l-2 border-l-slate-400 bg-slate-50/40"
                        />
                      ) : (
                        shownLocations.map((loc, locIdx) => {
                          const closed = closureSet.has(`${loc.id}|${d}`);
                          const k = `${line.id}|${loc.id}|${d}`;
                          const cellAsgs = cellMap.get(k) ?? [];
                          return (
                            <Cell
                              key={`${d}-${loc.id}`}
                              closed={closed}
                              accent={loc.color ?? "#cbd5e1"}
                              isDayStart={locIdx === 0}
                              assignments={cellAsgs}
                              personById={personById}
                              weeklyCount={weeklyCount}
                              conflictReasons={conflictReasons}
                              weekTimeOff={weekTimeOff}
                              isPublished={isPublished}
                              canEdit={canEdit}
                              onAdd={() =>
                                setPicker({
                                  lineId: line.id,
                                  locationId: loc.id,
                                  day: d,
                                })
                              }
                              onRemove={(id) =>
                                start(async () => {
                                  await removeAssignment(id);
                                  router.refresh();
                                })
                              }
                              onMovePerson={(assignmentId) =>
                                start(async () => {
                                  await moveAssignment(
                                    assignmentId,
                                    line.id,
                                    loc.id,
                                    d,
                                  );
                                  router.refresh();
                                })
                              }
                              onAttendance={(id) => setAttMenu(id)}
                            />
                          );
                        })
                      ),
                    )}
                  </tr>
                ))}
              </DeptSection>
            ))}
            {grouped.length === 0 && (
              <tr>
                <td
                  colSpan={1 + DAYS.length}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  No shift lines planned for this week yet.
                  <button
                    onClick={() =>
                      start(async () => {
                        await applyDefaultTemplate(week.id);
                        router.refresh();
                      })
                    }
                    className="mx-auto mt-3 block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    ⚡ Load Week Template
                  </button>
                  <span className="mt-2 block text-xs text-slate-400">
                    or add ad-hoc lines below.
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PerEmployeePrintout weekStart={week.week_start} employees={perEmployee} />

      <div className="flex items-center justify-between gap-3 print:hidden">
        <Legend />
        <div className="flex shrink-0 items-center gap-2">
          {week.status === "draft" && (
            <button
              onClick={() =>
                start(async () => {
                  await applyDefaultTemplate(week.id);
                  router.refresh();
                })
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
              title="Load the standard default shift lines into this week"
            >
              ⚡ Week Template
            </button>
          )}
          <button
            onClick={() => setDeptModal({ dept: null })}
            className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600"
          >
            + Add department
          </button>
          <button
            onClick={() => setLineModal({ line: null })}
            className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600"
          >
            + Add shift line
          </button>
        </div>
      </div>

      {lineModal && (
        <LineModal
          weekId={week.id}
          departments={setup.departments}
          roles={setup.roles}
          line={lineModal.line}
          defaultDeptId={lineModal.deptId}
          onClose={() => setLineModal(null)}
          onDone={() => {
            setLineModal(null);
            router.refresh();
          }}
        />
      )}

      {deptModal && (
        <DeptModal
          dept={deptModal.dept}
          onClose={() => setDeptModal(null)}
          onDone={() => {
            setDeptModal(null);
            router.refresh();
          }}
        />
      )}

      {eventModal && (
        <EventModal
          location={
            availableLocations.find((l) => l.id === eventModal.locationId)!
          }
          day={eventModal.day}
          weekStart={week.week_start}
          initial={eventModal.title}
          onClose={() => setEventModal(null)}
          onSave={(title) =>
            start(async () => {
              await setEvent(
                week.id,
                eventModal.locationId,
                eventModal.day,
                title,
              );
              setEventModal(null);
              router.refresh();
            })
          }
        />
      )}

      {picker && (
        <EligiblePicker
          cell={picker}
          line={lines.find((l) => l.id === picker.lineId)!}
          location={availableLocations.find((l) => l.id === picker.locationId)!}
          people={setup.people}
          settings={setup.settings}
          membersByRole={membersByRole}
          roleName={roleName}
          roles={setup.roles}
          weeklyCount={weeklyCount}
          scheduledByDay={scheduledByDay}
          weekTimeOff={weekTimeOff}
          assignedHere={new Set(
            (cellMap.get(
              `${picker.lineId}|${picker.locationId}|${picker.day}`,
            ) ?? [])
              .filter((a) => !a.removed_post_publish)
              .map((a) => a.person_id),
          )}
          onClose={() => setPicker(null)}
          onPick={(personId) =>
            start(async () => {
              await assignPerson(
                week.id,
                picker.lineId,
                picker.locationId,
                picker.day,
                personId,
              );
              router.refresh();
            })
          }
        />
      )}

      {attMenu && (
        <AttendanceMenu
          assignment={assignments.find((a) => a.id === attMenu)!}
          person={personById.get(
            assignments.find((a) => a.id === attMenu)!.person_id,
          )}
          onClose={() => setAttMenu(null)}
          onMark={(status, note) =>
            start(async () => {
              await markAttendance(attMenu, status, note);
              setAttMenu(null);
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: week picker + location toggles + workflow
// ---------------------------------------------------------------------------

function Toolbar({
  week,
  weeks,
  availableLocations,
  enabled,
  setEnabled,
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
  onStatus,
}: {
  week: SchedWeek;
  weeks: SchedWeek[];
  availableLocations: ScheduleLocation[];
  enabled: Set<string>;
  setEnabled: (s: Set<string>) => void;
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
  onStatus: (s: SchedWeek["status"]) => void;
}) {
  function toggle(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEnabled(next);
  }

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {formatWeekRange(week.week_start)}
          </h1>
          <span
            className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SCHEDULE_STATUS_TONE[week.status]}`}
          >
            {SCHEDULE_STATUS_LABELS[week.status]}
          </span>
        </div>
        <WorkflowButtons
          status={week.status}
          onStatus={onStatus}
          onPrintGrid={onPrintGrid}
          onPrintEmployee={onPrintEmployee}
          onExportCsv={onExportCsv}
        />
      </div>

      <WeekPicker weeks={weeks} selectedId={week.id} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Locations:
        </span>
        {availableLocations.map((loc) => {
          const on = enabled.has(loc.id);
          return (
            <button
              key={loc.id}
              onClick={() => toggle(loc.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                on
                  ? "border-transparent text-white shadow-sm"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
              style={on ? { background: loc.color ?? "#475569" } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: on ? "#fff" : loc.color ?? "#475569" }}
              />
              {loc.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowButtons({
  status,
  onStatus,
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
}: {
  status: SchedWeek["status"];
  onStatus: (s: SchedWeek["status"]) => void;
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
}) {
  const btn =
    "rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <button
          onClick={() => onStatus("pending_approval")}
          className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
        >
          Submit for approval
        </button>
      )}
      {status === "pending_approval" && (
        <>
          <button
            onClick={() => onStatus("approved")}
            className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}
          >
            Approve
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Send back
          </button>
        </>
      )}
      {status === "approved" && (
        <>
          <button
            onClick={() => onStatus("published")}
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            Publish
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Reopen
          </button>
        </>
      )}
      {status === "published" && (
        <>
          <button
            onClick={onPrintGrid}
            className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}
            title="Print the schedule grid exactly as shown"
          >
            Print Grid
          </button>
          <button
            onClick={onPrintEmployee}
            className={`${btn} bg-slate-700 text-white hover:bg-slate-800`}
            title="Print one page per employee listing all of their shifts (optimized for entering into When I Work)"
          >
            Export Per Employee
          </button>
          <button
            onClick={onExportCsv}
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            title="Download a CSV grouped by Location then Employee — matching how you enter shifts into When I Work (pick a location, then work employee-by-employee)"
          >
            CSV for When I Work
          </button>
          <button
            onClick={() => onStatus("draft")}
            className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Reopen
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-employee printout: one page per employee, hidden on screen, revealed
// only when the grid root carries the `sched-print-employee` class.
// ---------------------------------------------------------------------------

type EmployeeSchedule = {
  person: SchedPerson;
  shifts: {
    day: number;
    date: string;
    start: string | null;
    end: string | null;
    location: string;
    position: string;
  }[];
};

function PerEmployeePrintout({
  weekStart,
  employees,
}: {
  weekStart: string;
  employees: EmployeeSchedule[];
}) {
  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="sched-employee-print">
      {employees.map(({ person, shifts }) => (
        <section key={person.id} className="sched-emp-page mb-8">
          <div className="mb-3 flex items-baseline justify-between border-b-2 border-slate-800 pb-2">
            <h2 className="text-xl font-bold text-slate-900">
              {gridName(person)}
            </h2>
            <span className="text-sm font-medium text-slate-600">
              Week of {formatWeekRange(weekStart)}
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-1.5 pr-4 font-semibold text-slate-700">Date</th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">
                  Start
                </th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">End</th>
                <th className="py-1.5 pr-4 font-semibold text-slate-700">
                  Position
                </th>
                <th className="py-1.5 font-semibold text-slate-700">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="py-1.5 pr-4">{fmtDate(s.date)}</td>
                  <td className="py-1.5 pr-4 font-mono">
                    {formatClock(s.start) || "—"}
                  </td>
                  <td className="py-1.5 pr-4 font-mono">
                    {formatClock(s.end) || "—"}
                  </td>
                  <td className="py-1.5 pr-4">{s.position}</td>
                  <td className="py-1.5">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            Total shifts: {shifts.length}
          </p>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Department section header row
// ---------------------------------------------------------------------------

function DeptSection({
  dept,
  span,
  collapsed,
  lineCount,
  onToggle,
  onAddLine,
  onEditDept,
  children,
}: {
  dept: SchedDepartment;
  span: number;
  collapsed: boolean;
  lineCount: number;
  onToggle: () => void;
  onAddLine: () => void;
  onEditDept: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={span}
          className="group/dept sticky left-0 z-10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{ background: dept.color }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              title={collapsed ? "Expand department" : "Collapse department"}
              aria-expanded={!collapsed}
              className="flex flex-1 items-center gap-1.5 text-left hover:text-white/90"
            >
              <span
                className={`inline-block text-[9px] transition-transform ${
                  collapsed ? "-rotate-90" : ""
                }`}
              >
                ▼
              </span>
              <span>{dept.name}</span>
              {collapsed && lineCount > 0 && (
                <span className="rounded bg-white/20 px-1.5 text-[9px] font-semibold">
                  {lineCount}
                </span>
              )}
            </button>
            <button
              onClick={onAddLine}
              title="Add shift line to this department"
              className="rounded bg-white/20 px-1.5 text-[10px] font-semibold opacity-0 transition hover:bg-white/30 group-hover/dept:opacity-100 print:hidden"
            >
              + line
            </button>
            <button
              onClick={onEditDept}
              title="Edit department"
              className="text-[11px] opacity-0 transition hover:text-white/80 group-hover/dept:opacity-100 print:hidden"
            >
              ✎
            </button>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// A single grid cell
// ---------------------------------------------------------------------------

function Cell({
  closed,
  accent,
  isDayStart,
  assignments,
  personById,
  weeklyCount,
  conflictReasons,
  weekTimeOff,
  isPublished,
  canEdit,
  onAdd,
  onRemove,
  onMovePerson,
  onAttendance,
}: {
  closed: boolean;
  accent: string;
  isDayStart?: boolean;
  assignments: SchedAssignment[];
  personById: Map<string, SchedPerson>;
  weeklyCount: Map<string, number>;
  conflictReasons: Map<string, string[]>;
  weekTimeOff: WeekTimeOff;
  isPublished: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMovePerson: (assignmentId: string) => void;
  onAttendance: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dayBorder = isDayStart
    ? "border-l-2 border-l-slate-400"
    : "border-l border-l-slate-200";
  if (closed) {
    return (
      <td
        className={`border-b border-b-slate-200 ${dayBorder} bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)] align-middle`}
        style={{ width: 18, minWidth: 18, maxWidth: 18 }}
        title="Location closed"
      />
    );
  }
  const visible = assignments.filter((a) => !a.removed_post_publish);
  const removed = assignments.filter((a) => a.removed_post_publish);

  // Drag-and-drop is gated on edit permission. The drop handler ignores rows
  // that already live in this cell so re-dropping in place is a clean no-op.
  const idsHere = new Set(visible.map((a) => a.id));

  return (
    <td
      className={`group border-b border-b-slate-200 ${dayBorder} align-top ${
        dragOver ? "outline outline-2 -outline-offset-2 outline-emerald-400" : ""
      }`}
      style={{
        width: 128,
        minWidth: 128,
        maxWidth: 128,
        backgroundColor: dragOver ? `${accent}33` : `${accent}14`,
        ...(isDayStart ? {} : { borderLeftColor: `${accent}55` }),
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!dragOver) setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const id = e.dataTransfer.getData("text/plain");
              if (id && !idsHere.has(id)) onMovePerson(id);
            }
          : undefined
      }
    >
      <div className="flex min-h-[34px] flex-col gap-0.5 p-1">
        {visible.map((a) => {
          const p = personById.get(a.person_id);
          const att = effectiveAttendance(a, isPublished);
          const marked = att !== "scheduled";
          const conflicts = conflictReasons.get(a.id);
          const hasConflict = !!conflicts?.length;
          const conflictTitle = hasConflict
            ? `Double-booked — also scheduled at: ${conflicts!.join("; ")}`
            : undefined;
          // Time-off clash: scheduled on a day this person has requested or
          // approved time off. Skip when the shift was already marked PTO —
          // that means the scheduler has already acknowledged it.
          const off = weekTimeOff.get(a.person_id)?.get(a.day_of_week);
          const hasTimeOff = !!off && att !== "pto";
          const timeOffTitle = hasTimeOff
            ? `Time off ${off === "approved" ? "approved" : "requested"} for this day`
            : undefined;
          return (
            <div
              key={a.id}
              draggable={canEdit}
              onDragStart={
                canEdit
                  ? (e) => {
                      e.dataTransfer.setData("text/plain", a.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
                hasConflict
                  ? "bg-red-100 text-red-700 ring-1 ring-red-500"
                  : hasTimeOff
                    ? "bg-violet-100 text-violet-700 ring-1 ring-violet-500"
                    : marked
                      ? ATTENDANCE_TONE[att]
                      : "bg-slate-100 text-slate-700"
              } ${a.added_post_publish ? "ring-1 ring-sky-400" : ""} ${
                canEdit ? "cursor-grab active:cursor-grabbing" : ""
              }`}
              title={
                conflictTitle ??
                timeOffTitle ??
                (canEdit
                  ? `${p ? gridName(p) : ""} — drag to move`
                  : p
                    ? gridName(p)
                    : "")
              }
            >
              {hasConflict ? (
                <span className="shrink-0 text-red-600" aria-hidden>
                  ⚠
                </span>
              ) : hasTimeOff ? (
                <span className="shrink-0 text-violet-600" aria-hidden>
                  🌴
                </span>
              ) : null}
              <button
                onClick={() => isPublished && onAttendance(a.id)}
                className={`flex-1 truncate text-left ${hasConflict || hasTimeOff ? "font-semibold" : ""} ${isPublished ? "cursor-pointer hover:underline" : ""}`}
                title={conflictTitle ?? timeOffTitle ?? (p ? gridName(p) : "")}
              >
                {p ? gridName(p) : "—"}
              </button>
              <span className="rounded-full bg-white/70 px-1 text-[9px] font-semibold text-slate-500">
                {weeklyCount.get(a.person_id) ?? 0}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                className="text-slate-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100 print:hidden"
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
        {removed.map((a) => {
          const p = personById.get(a.person_id);
          return (
            <div
              key={a.id}
              className="flex items-center gap-1 rounded bg-red-50 px-1 py-0.5 text-[11px] text-red-400 line-through"
              title="Removed after publish — counted as absent"
            >
              <span className="flex-1 truncate">{p ? gridName(p) : "—"}</span>
              <span className="text-[9px] font-semibold uppercase">abs</span>
            </div>
          );
        })}
        <button
          onClick={onAdd}
          className="rounded border border-dashed border-slate-200 py-0.5 text-[10px] text-slate-300 opacity-0 transition hover:border-emerald-300 hover:text-emerald-500 group-hover:opacity-100 print:hidden"
        >
          + add
        </button>
      </div>
    </td>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 print:hidden">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-200" />
        Scheduled
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded ring-1 ring-sky-400" />
        Added after publish
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-amber-100" /> Late
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-red-100" /> Absent
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-violet-100" /> PTO
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-red-100 ring-1 ring-red-500" />
        <span className="text-red-600">⚠</span> Double-booked
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-violet-100 ring-1 ring-violet-500" />
        <span className="text-violet-600">🌴</span> Scheduled on time off
      </span>
      <span className="ml-2">
        Number next to a name = shifts already assigned that week.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eligible-employee picker
// ---------------------------------------------------------------------------

function EligiblePicker({
  cell,
  line,
  location,
  people,
  settings,
  membersByRole,
  roleName,
  roles,
  weeklyCount,
  scheduledByDay,
  weekTimeOff,
  assignedHere,
  onClose,
  onPick,
}: {
  cell: CellKey;
  line: SchedWeekLine;
  location: ScheduleLocation;
  people: SchedPerson[];
  settings: SetupData["settings"];
  membersByRole: Map<string, Set<string>>;
  roleName: (id: string | null) => string | null;
  roles: SchedRole[];
  weeklyCount: Map<string, number>;
  scheduledByDay: Map<number, Set<string>>;
  weekTimeOff: WeekTimeOff;
  assignedHere: Set<string>;
  onClose: () => void;
  onPick: (personId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const settingByPerson = useMemo(
    () => new Map(settings.map((s) => [s.person_id, s])),
    [settings],
  );

  const roleById = useMemo(
    () => new Map(roles.map((r) => [r.id, r] as const)),
    [roles],
  );

  // Roles each person belongs to (inverted membersByRole) for quick filters.
  const rolesByPerson = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [roleId, persons] of membersByRole) {
      for (const pid of persons) {
        if (!m.has(pid)) m.set(pid, new Set());
        m.get(pid)!.add(roleId);
      }
    }
    return m;
  }, [membersByRole]);

  // Distinct role *names* each person belongs to. Multiple role records can
  // share a display name (e.g. several "DVM" roles), so we collapse by name to
  // avoid duplicate filter options.
  const roleNamesByPerson = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [pid, ids] of rolesByPerson) {
      const names = new Set<string>();
      for (const id of ids) {
        const name = roleById.get(id)?.name;
        if (name) names.add(name);
      }
      m.set(pid, names);
    }
    return m;
  }, [rolesByPerson, roleById]);

  // People eligible for this shift before role/search filters apply.
  const baseEligible = useMemo(() => {
    const roleMembers = line.role_id ? membersByRole.get(line.role_id) : null;
    return people.filter((p) => {
      const s = settingByPerson.get(p.id);
      if (s && !s.is_schedulable) return false;
      if (roleMembers && !roleMembers.has(p.id)) return false;
      // Location eligibility: empty list = any location.
      if (
        s &&
        s.eligible_location_ids.length > 0 &&
        !s.eligible_location_ids.includes(cell.locationId)
      )
        return false;
      // Day availability: empty list = any day.
      if (
        s &&
        s.available_days.length > 0 &&
        !s.available_days.includes(cell.day)
      )
        return false;
      return true;
    });
  }, [people, line.role_id, membersByRole, settingByPerson, cell.locationId, cell.day]);

  // Role filter options: distinct role names represented among eligible
  // people, sorted by the lowest sort_order of any role record with that name.
  const availableRoles = useMemo(() => {
    const byName = new Map<string, number>();
    for (const p of baseEligible) {
      const names = roleNamesByPerson.get(p.id);
      if (!names) continue;
      for (const name of names) {
        for (const r of roles) {
          if (r.name !== name) continue;
          const existing = byName.get(name);
          if (existing === undefined || r.sort_order < existing) {
            byName.set(name, r.sort_order);
          }
        }
      }
    }
    return [...byName.entries()]
      .map(([name, sort_order]) => ({ name, sort_order }))
      .sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      );
  }, [baseEligible, roleNamesByPerson, roles]);

  const eligible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const offRank = (id: string) => {
      const off = weekTimeOff.get(id)?.get(cell.day);
      // Available first, then pending time-off, then approved time-off.
      return off === "approved" ? 2 : off === "requested" ? 1 : 0;
    };
    return baseEligible
      .filter((p) => {
        if (roleFilter && !roleNamesByPerson.get(p.id)?.has(roleFilter))
          return false;
        if (term && !gridName(p).toLowerCase().includes(term)) return false;
        return true;
      })
      .sort((a, b) => {
        const oa = offRank(a.id);
        const ob = offRank(b.id);
        if (oa !== ob) return oa - ob; // available before time-off
        const ca = weeklyCount.get(a.id) ?? 0;
        const cb = weeklyCount.get(b.id) ?? 0;
        if (ca !== cb) return ca - cb; // least-loaded first
        return gridName(a).localeCompare(gridName(b));
      });
  }, [
    baseEligible,
    roleFilter,
    roleNamesByPerson,
    q,
    weeklyCount,
    weekTimeOff,
    cell.day,
  ]);

  const dayScheduled = scheduledByDay.get(cell.day) ?? new Set<string>();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                {line.label || roleName(line.role_id) || "Shift"}
              </h3>
              <p className="text-xs text-slate-500">
                {DAY_LABELS[cell.day]} · {location.name} ·{" "}
                {timeRange(line.start_time, line.end_time)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search eligible employees…"
            className="mt-3 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          {availableRoles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                onClick={() => setRoleFilter(null)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  roleFilter === null
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All
              </button>
              {availableRoles.map((r) => (
                <button
                  key={r.name}
                  onClick={() =>
                    setRoleFilter((cur) => (cur === r.name ? null : r.name))
                  }
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                    roleFilter === r.name
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {eligible.map((p) => {
            const s = settingByPerson.get(p.id);
            const count = weeklyCount.get(p.id) ?? 0;
            const target = s?.weekly_shift_target ?? 5;
            const here = assignedHere.has(p.id);
            const elsewhere = !here && dayScheduled.has(p.id);
            const atTarget = count >= target;
            const off = weekTimeOff.get(p.id)?.get(cell.day);
            return (
              <li key={p.id}>
                <button
                  disabled={here}
                  onClick={() => onPick(p.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    here
                      ? "cursor-default bg-emerald-50 text-emerald-700"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <span className="flex-1 truncate text-slate-700">
                    {gridName(p)}
                    {off && (
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          off === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                        title={
                          off === "approved"
                            ? "Approved time off"
                            : "Pending time-off request"
                        }
                      >
                        {off === "approved" ? "Off" : "Off?"}
                      </span>
                    )}
                    {elsewhere && (
                      <span
                        className="ml-1.5 text-[10px] font-medium text-amber-600"
                        title="Already scheduled this day"
                      >
                        ● today
                      </span>
                    )}
                  </span>
                  {here ? (
                    <span className="text-xs font-semibold">✓ added</span>
                  ) : (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        atTarget
                          ? "bg-red-100 text-red-600"
                          : "bg-slate-100 text-slate-500"
                      }`}
                      title="Shifts this week / target"
                    >
                      {count}/{target}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {eligible.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-slate-400">
              No eligible employees. Assign people to this role in Set Up →
              Roles & Eligibility.
            </li>
          )}
        </ul>
        <div className="border-t border-slate-200 p-3 text-right">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance marking menu
// ---------------------------------------------------------------------------

function AttendanceMenu({
  assignment,
  person,
  onClose,
  onMark,
}: {
  assignment: SchedAssignment;
  person: SchedPerson | undefined;
  onClose: () => void;
  onMark: (status: AttendanceStatus, note: string | null) => void;
}) {
  const [note, setNote] = useState(assignment.attendance_note ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              {person ? gridName(person) : "Attendance"}
            </h3>
            <p className="text-xs text-slate-500">
              Current:{" "}
              <span className="font-medium">
                {ATTENDANCE_LABELS[effectiveAttendance(assignment, true)]}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            {MARKABLE_ATTENDANCE.map((s) => (
              <button
                key={s}
                onClick={() => onMark(s, note.trim() || null)}
                className={`rounded-lg px-2 py-2 text-xs font-semibold ${ATTENDANCE_TONE[s]} ring-1 ring-inset ring-black/5 hover:opacity-80`}
              >
                {ATTENDANCE_LABELS[s]}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => onMark("scheduled", note.trim() || null)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Clear marking (assume Present)
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add or edit a per-location/day event banner
// ---------------------------------------------------------------------------

function EventModal({
  location,
  day,
  weekStart,
  initial,
  onClose,
  onSave,
}: {
  location: ScheduleLocation;
  day: number;
  weekStart: string;
  initial: string;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(initial);
  const dateLabel = new Date(
    `${dateForDay(weekStart, day)}T00:00:00`,
  ).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: location.color ?? "#64748b" }}
            />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Event · {location.name}
              </h3>
              <p className="text-xs text-slate-500">{dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(title);
            }}
            placeholder="e.g. Full Team Meeting, Adoption Event…"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex justify-between gap-2 pt-1">
            <button
              onClick={() => onSave("")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => onSave(title)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add or edit a shift line on the week's grid
// ---------------------------------------------------------------------------

function LineModal({
  weekId,
  departments,
  roles,
  line,
  defaultDeptId,
  onClose,
  onDone,
}: {
  weekId: string;
  departments: SetupData["departments"];
  roles: SetupData["roles"];
  line: SchedWeekLine | null;
  defaultDeptId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deptId, setDeptId] = useState(
    line?.department_id ?? defaultDeptId ?? "",
  );
  // "" = any · "__new__" = create role inline · otherwise an existing role id.
  const [roleSel, setRoleSel] = useState<string>(line?.role_id ?? "");
  const deptRoles = roles.filter((r) => r.department_id === deptId);

  function submit(fd: FormData) {
    setError(null);
    fd.set("week_id", weekId);
    fd.set("department_id", deptId);
    if (line) fd.set("id", line.id);
    if (roleSel === "__new__") {
      fd.set("role_id", "");
    } else {
      fd.set("role_id", roleSel);
      fd.delete("new_role_name");
    }
    start(async () => {
      const res = line ? await updateWeekLine(fd) : await addWeekLine(fd);
      if (!res.ok) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        action={submit}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            {line ? "Edit shift line" : "Add shift line"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          Department
          <select
            value={deptId}
            onChange={(e) => {
              setDeptId(e.target.value);
              setRoleSel("");
            }}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Role (eligibility)
          <select
            value={roleSel}
            onChange={(e) => setRoleSel(e.target.value)}
            disabled={!deptId}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
          >
            <option value="">— any —</option>
            {deptRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__new__">+ New role…</option>
          </select>
        </label>
        {roleSel === "__new__" && (
          <label className="block text-xs font-medium text-slate-500">
            New role name
            <input
              name="new_role_name"
              required
              placeholder="e.g. Surgery Tech"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Set who is eligible for it in Set Up → Roles &amp; Eligibility.
            </span>
          </label>
        )}
        <label className="block text-xs font-medium text-slate-500">
          Label (optional)
          <input
            name="label"
            defaultValue={line?.label ?? ""}
            placeholder="e.g. Float / Coverage"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Start
            <input
              name="start_time"
              type="time"
              defaultValue={line?.start_time ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            End
            <input
              name="end_time"
              type="time"
              defaultValue={line?.end_time ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={line?.sort_order ?? 9999}
              className="mt-1 w-16 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {line ? "Save" : "Add line"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add or edit a department directly from the grid
// ---------------------------------------------------------------------------

function DeptModal({
  dept,
  onClose,
  onDone,
}: {
  dept: SchedDepartment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    if (dept) fd.set("id", dept.id);
    start(async () => {
      const res = await saveDepartment(fd);
      if (!res.ok) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        action={submit}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            {dept ? "Edit department" : "Add department"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          Name
          <input
            name="name"
            defaultValue={dept?.name ?? ""}
            required
            placeholder="e.g. Surgery"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Color
            <input
              name="color"
              type="color"
              defaultValue={dept?.color ?? "#64748b"}
              className="mt-1 block h-9 w-16 cursor-pointer rounded border border-slate-300"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={dept?.sort_order ?? 9999}
              className="mt-1 w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>
        <input type="hidden" name="is_active" value="on" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {dept ? (
            <DeleteDeptButton dept={dept} onDone={onDone} setError={setError} />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {dept ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function DeleteDeptButton({
  dept,
  onDone,
  setError,
}: {
  dept: SchedDepartment;
  onDone: () => void;
  setError: (s: string | null) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete department "${dept.name}"? Its roles and shift lines will be removed.`,
          )
        )
          return;
        setError(null);
        start(async () => {
          const res = await deleteDepartment(dept.id);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      Delete
    </button>
  );
}
