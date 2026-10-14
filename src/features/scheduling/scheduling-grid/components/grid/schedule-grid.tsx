"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAY_SHORT,
  buildWeekTimeOff,
  dateForDay,
  timeRange,
  type SchedAssignment,
  type SchedDepartment,
  type SchedEvent,
  type SchedWeek,
  type SchedWeekLine,
} from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  assignPerson,
  moveAssignment,
  removeAssignment,
} from "@/features/scheduling/scheduling-grid/actions/assignment-actions";
import { markAttendance } from "@/features/scheduling/scheduling-grid/actions/attendance-actions";
import { toggleClosure } from "@/features/scheduling/scheduling-grid/actions/closure-actions";
import { setEvent } from "@/features/scheduling/scheduling-grid/actions/event-actions";
import { setTimeOffStatus } from "@/features/scheduling/scheduling-grid/actions/time-off-actions";
import {
  applyDefaultTemplate,
  removeWeekLine,
} from "@/features/scheduling/scheduling-grid/actions/week-line-actions";
import { setWeekStatus } from "@/features/scheduling/scheduling-grid/actions/week-status-actions";
import { buildConflictReasons } from "@/features/scheduling/scheduling-grid/lib/conflict-reasons";
import { buildWiwCsvRows, toCsvText } from "@/features/scheduling/scheduling-grid/lib/csv";
import { downloadCsvFile } from "@/features/scheduling/scheduling-grid/lib/download-csv";
import { COL_W, DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import { buildPerEmployeeShifts } from "@/features/scheduling/scheduling-grid/lib/per-employee-shifts";
import { buildPtoByDay } from "@/features/scheduling/scheduling-grid/lib/pto-by-day";
import type { AgendaCount } from "@/features/scheduling/scheduling-grid/types/agenda-count";
import type { CellKey, GridTimeOffRow, PtoChip } from "@/features/scheduling/scheduling-grid/types/grid";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";
import { AttendanceMenu } from "@/features/scheduling/scheduling-grid/components/attendance-menu";
import { DeptModal } from "@/features/scheduling/scheduling-grid/components/dept-modal";
import { DeptSection } from "@/features/scheduling/scheduling-grid/components/dept-section";
import { EligiblePicker } from "@/features/scheduling/scheduling-grid/components/eligible-picker";
import { EventModal } from "@/features/scheduling/scheduling-grid/components/event-modal";
import { GridCell } from "@/features/scheduling/scheduling-grid/components/grid/grid-cell";
import { GridLegend } from "@/features/scheduling/scheduling-grid/components/grid/grid-legend";
import { GridToolbar } from "@/features/scheduling/scheduling-grid/components/grid/grid-toolbar";
import { LineModal } from "@/features/scheduling/scheduling-grid/components/line-modal";
import { PerEmployeePrintout } from "@/features/scheduling/scheduling-grid/components/per-employee-printout";
import { PtoDecisionMenu } from "@/features/scheduling/scheduling-grid/components/pto-decision-menu";
import { PtoSection } from "@/features/scheduling/scheduling-grid/components/pto-section";
import { ReadOnlyNotice } from "@/features/scheduling/scheduling-grid/components/read-only-notice";

/**
 * The weekly grid: shift lines (rows, grouped by department) × days ×
 * locations (columns), with the PTO overview on top. Owns every piece of
 * interaction state (pickers, menus, modals, print mode, scroll sync) and
 * calls the Server Actions; the pure lookups it derives live in `lib/`.
 */
export function ScheduleGrid({
  weeks,
  weekData,
  setup,
  timeOff,
  agendaCounts = [],
  canEdit = false,
  templateMode = false,
  templates = [],
}: {
  weeks: SchedWeek[];
  weekData: WeekData;
  setup: SetupData;
  timeOff: GridTimeOffRow[];
  agendaCounts?: AgendaCount[];
  canEdit?: boolean;
  templateMode?: boolean;
  templates?: SchedWeek[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const { week, lines, weekLocations, closures, events, assignments } = weekData;
  // Time-clock grades for unmarked shifts (empty until attendance goes live).
  const systemAttendance = weekData.systemAttendance ?? {};
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

  // Who is off each day, for the collapsible PTO section (chips keep their
  // request id for approve/deny).
  const ptoByDay = useMemo(
    () => buildPtoByDay(timeOff, personById, week.week_start),
    [timeOff, personById, week.week_start],
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

  // Double-booking detection: flagged (not blocked) so the grid can highlight
  // the offending assignments in red with a reason in the tooltip.
  const conflictReasons = useMemo(
    () => buildConflictReasons(activeAssignments, lines, setup.locations),
    [activeAssignments, lines, setup.locations],
  );

  const closureSet = useMemo(
    () => new Set(closures.map((c) => `${c.location_id}|${c.day_of_week}`)),
    [closures],
  );

  const eventMap = useMemo(() => {
    const m = new Map<string, SchedEvent>();
    for (const e of events) m.set(`${e.location_id}|${e.day_of_week}`, e);
    return m;
  }, [events]);

  // Booked-appointment demand (ezyVet Agenda) keyed by dept|location|date.
  // Only future days within the ingested 4-week window carry counts, so past
  // weeks render blank automatically.
  const agendaCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agendaCounts) {
      m.set(`${a.department_id}|${a.location_id}|${a.appt_date}`, a.appt_count);
    }
    return m;
  }, [agendaCounts]);

  const agendaDeptIds = useMemo(
    () => new Set(agendaCounts.map((a) => a.department_id)),
    [agendaCounts],
  );

  // Lines grouped by department, in order.
  const grouped = useMemo(() => {
    const byDept = new Map<string, SchedWeekLine[]>();
    for (const l of lines) {
      if (!byDept.has(l.department_id)) byDept.set(l.department_id, []);
      byDept.get(l.department_id)!.push(l);
    }
    const order = [...setup.departments]
      .sort((a, b) => a.sort_order - b.sort_order)
      // The template is where shift lines are authored, so every active
      // department stays visible there even before it has a line.
      .filter((d) =>
        templateMode
          ? d.is_active
          : byDept.has(d.id) || agendaDeptIds.has(d.id),
      );
    return order.map((d) => ({
      dept: d,
      lines: (byDept.get(d.id) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    }));
  }, [lines, setup.departments, agendaDeptIds, templateMode]);

  // Per-employee shift list for the "Export per employee" printout.
  const perEmployee = useMemo(
    () =>
      buildPerEmployeeShifts({
        assignments,
        lines,
        locations: setup.locations,
        roles: setup.roles,
        personById,
        weekStart: week.week_start,
      }),
    [assignments, lines, personById, setup.locations, setup.roles, week.week_start],
  );

  // Build the When I Work-friendly CSV (grouped by Location, then Employee —
  // the order the admin re-keys shifts in) and trigger a download.
  const downloadWiwCsv = () => {
    const rows = buildWiwCsvRows({
      assignments,
      lines,
      roles: setup.roles,
      locations: setup.locations,
      personById,
      weekStart: week.week_start,
    });
    downloadCsvFile(`schedule-${week.week_start}-wheniwork.csv`, toCsvText(rows));
  };

  // UI state
  const [picker, setPicker] = useState<CellKey | null>(null);
  const [attMenu, setAttMenu] = useState<string | null>(null);
  const [ptoMenu, setPtoMenu] = useState<{ chip: PtoChip; day: number } | null>(
    null,
  );
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
    () => new Set(setup.departments.map((d) => d.id)),
  );

  // The PTO overview section sits at the top of the grid, expanded by default.
  const [ptoCollapsed, setPtoCollapsed] = useState(false);

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
      {!canEdit && <ReadOnlyNotice />}
      <GridToolbar
        week={week}
        weeks={weeks}
        availableLocations={availableLocations}
        enabled={enabled}
        setEnabled={setEnabled}
        templateMode={templateMode}
        templates={templates}
        onPrintGrid={() => setPrintMode("grid")}
        onPrintEmployee={() => setPrintMode("employee")}
        onExportCsv={downloadWiwCsv}
        onStatus={(s) =>
          start(async () => {
            const res = await setWeekStatus(week.id, s);
            if (!res.ok && "untimed" in res) {
              const list = res.untimed.slice(0, 10).join("\n");
              const more = res.untimed.length > 10 ? `\n…and ${res.untimed.length - 10} more` : "";
              if (window.confirm(`${res.error}\n\n${list}${more}\n\nPublish anyway?`)) {
                await setWeekStatus(week.id, s, { confirmUntimed: true });
              }
            } else if (!res.ok) {
              window.alert(res.error);
            }
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
                  {!templateMode && (
                    <span className="font-normal text-slate-400">
                      {new Date(
                        `${dateForDay(week.week_start, d)}T00:00:00`,
                      ).getDate()}
                    </span>
                  )}
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
                            : { width: COL_W, minWidth: COL_W, maxWidth: COL_W }
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
                          width: closed ? 18 : COL_W,
                          minWidth: closed ? 18 : COL_W,
                          maxWidth: closed ? 18 : COL_W,
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
            {!templateMode && (
              <PtoSection
                colCount={colCount}
                span={1 + DAYS.length * Math.max(colCount, 1)}
                collapsed={ptoCollapsed}
                ptoByDay={ptoByDay}
                weekCount={weekTimeOff.size}
                canEdit={canEdit}
                onToggle={() => setPtoCollapsed((v) => !v)}
                onDecide={(chip, day) => setPtoMenu({ chip, day })}
              />
            )}
            {grouped.map(({ dept, lines: deptLines }) => (
              <DeptSection
                key={dept.id}
                dept={dept}
                span={1 + DAYS.length * Math.max(colCount, 1)}
                collapsed={collapsedDepts.has(dept.id)}
                lineCount={deptLines.length}
                shownLocations={shownLocations}
                closureSet={closureSet}
                weekStart={week.week_start}
                agendaCountMap={agendaCountMap}
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
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <span className="whitespace-nowrap text-[12px] font-medium text-slate-800">
                            {line.label || roleName(line.role_id) || "Shift"}
                            {line.is_adhoc && (
                              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-700">
                                +
                              </span>
                            )}
                          </span>
                          <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
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
                            <GridCell
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
                              systemAttendance={systemAttendance}
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
                {!collapsedDepts.has(dept.id) && deptLines.length === 0 && (
                  <tr>
                    <td
                      colSpan={1 + DAYS.length * Math.max(colCount, 1)}
                      className="border-b border-slate-200 px-3 py-2 text-left text-xs text-slate-400"
                      style={{ borderLeft: `3px solid ${dept.color}` }}
                    >
                      No shift lines for {dept.name} yet.
                      {canEdit && (
                        <button
                          onClick={() =>
                            setLineModal({ line: null, deptId: dept.id })
                          }
                          className="ml-2 font-semibold text-emerald-600 hover:underline print:hidden"
                        >
                          + Add shift line
                        </button>
                      )}
                    </td>
                  </tr>
                )}
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
                    ⚡ Load Dept/Shift Template
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
        <GridLegend />
        <div className="flex shrink-0 items-center gap-2">
          {week.status === "draft" && !templateMode && (
            <button
              onClick={() =>
                start(async () => {
                  await applyDefaultTemplate(week.id);
                  router.refresh();
                })
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
              title="Load the Dept/Shift Template shift lines into this week"
            >
              ⚡ Dept/Shift Template
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
          systemStatus={systemAttendance[attMenu]}
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

      {ptoMenu && (
        <PtoDecisionMenu
          chip={ptoMenu.chip}
          day={ptoMenu.day}
          onClose={() => setPtoMenu(null)}
          onDecide={(status) =>
            start(async () => {
              await setTimeOffStatus(ptoMenu.chip.requestId, status);
              setPtoMenu(null);
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}
