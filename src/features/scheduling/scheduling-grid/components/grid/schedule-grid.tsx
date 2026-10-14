"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@tanstack/react-table";
import {
  buildWeekTimeOff,
  type SchedAssignment,
  type SchedEvent,
  type SchedWeek,
} from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { buildGridColumns } from "@/features/scheduling/scheduling-grid/columns/grid-columns";
import { DeptSectionRow } from "@/features/scheduling/scheduling-grid/components/grid/dept-section-row";
import { EmptyDeptRow } from "@/features/scheduling/scheduling-grid/components/grid/empty-dept-row";
import { GridDialogs } from "@/features/scheduling/scheduling-grid/components/grid/grid-dialogs";
import { GridFooterActions } from "@/features/scheduling/scheduling-grid/components/grid/grid-footer-actions";
import { GridHeader } from "@/features/scheduling/scheduling-grid/components/grid/grid-header";
import { GridLegend } from "@/features/scheduling/scheduling-grid/components/grid/grid-legend";
import { GridToolbar } from "@/features/scheduling/scheduling-grid/components/grid/grid-toolbar";
import { NoLinesRow } from "@/features/scheduling/scheduling-grid/components/grid/no-lines-row";
import { ShiftLineRow } from "@/features/scheduling/scheduling-grid/components/grid/shift-line-row";
import { PerEmployeePrintout } from "@/features/scheduling/scheduling-grid/components/per-employee-printout";
import { PtoSection } from "@/features/scheduling/scheduling-grid/components/pto-section";
import { ReadOnlyNotice } from "@/features/scheduling/scheduling-grid/components/read-only-notice";
import { GridContext } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { useGridActions } from "@/features/scheduling/scheduling-grid/hooks/use-grid-actions";
import { useGridUiState } from "@/features/scheduling/scheduling-grid/hooks/use-grid-ui-state";
import {
  columnVisibilityFor,
  defaultEnabledLocationIds,
  enabledLocationIds,
  toggleLocationVisibility,
} from "@/features/scheduling/scheduling-grid/lib/column-visibility";
import { buildConflictReasons } from "@/features/scheduling/scheduling-grid/lib/conflict-reasons";
import { buildWiwCsvRows, toCsvText } from "@/features/scheduling/scheduling-grid/lib/csv";
import { downloadCsvFile } from "@/features/scheduling/scheduling-grid/lib/download-csv";
import { DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import { buildGridRows } from "@/features/scheduling/scheduling-grid/lib/grid-rows";
import { gridTableFeatures } from "@/features/scheduling/scheduling-grid/lib/grid-table-features";
import { buildPerEmployeeShifts } from "@/features/scheduling/scheduling-grid/lib/per-employee-shifts";
import { buildPtoByDay } from "@/features/scheduling/scheduling-grid/lib/pto-by-day";
import type { AgendaCount } from "@/features/scheduling/scheduling-grid/types/agenda-count";
import type { GridTimeOffRow } from "@/features/scheduling/scheduling-grid/types/grid";
import type { GridContextValue } from "@/features/scheduling/scheduling-grid/types/grid-context";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";

/**
 * The weekly grid, as a TanStack Table: shift lines are the rows, grouped by
 * department (each department a collapsible group row), and the columns are
 * Sunday–Saturday, each a group of the available locations; which locations
 * show is the table's column visibility. The PTO overview sits above the
 * groups. This component owns the data lookups, the table instance and the
 * dialog state; the column definitions live in `columns/`, the renderers read
 * everything else through `GridContext`.
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
  const { week, lines, weekLocations, closures, events, assignments } = weekData;
  // Time-clock grades for unmarked shifts (empty until attendance goes live).
  const systemAttendance = useMemo(() => weekData.systemAttendance ?? {}, [weekData.systemAttendance]);
  const isPublished = week.status === "published";

  // Locations available on this week's grid, in display order.
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

  // Lookups -----------------------------------------------------------------
  const departmentById = useMemo(
    () => new Map(setup.departments.map((d) => [d.id, d])),
    [setup.departments],
  );
  const personById = useMemo(
    () => new Map(setup.people.map((p) => [p.id, p])),
    [setup.people],
  );
  const roleById = useMemo(() => new Map(setup.roles.map((r) => [r.id, r])), [setup.roles]);
  const roleName = useMemo(
    () => (id: string | null) => (id ? roleById.get(id)?.name ?? null : null),
    [roleById],
  );

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
    for (const a of activeAssignments) m.set(a.person_id, (m.get(a.person_id) ?? 0) + 1);
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
    for (const a of agendaCounts) m.set(`${a.department_id}|${a.location_id}|${a.appt_date}`, a.appt_count);
    return m;
  }, [agendaCounts]);

  const agendaDeptIds = useMemo(
    () => new Set(agendaCounts.map((a) => a.department_id)),
    [agendaCounts],
  );

  // The table ----------------------------------------------------------------
  const rows = useMemo(
    () => buildGridRows({ lines, departments: setup.departments, templateMode, agendaDeptIds }),
    [lines, setup.departments, templateMode, agendaDeptIds],
  );
  const columns = useMemo(() => buildGridColumns(availableLocations), [availableLocations]);
  // Read once: which locations open, every department collapsed.
  const [initialState] = useState(() => ({
    grouping: ["departmentId"],
    expanded: {},
    columnVisibility: columnVisibilityFor(
      availableLocations,
      defaultEnabledLocationIds(availableLocations, planLocationIds),
    ),
  }));

  const table = useTable({
    features: gridTableFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    initialState,
    // The grouping column is a device; its group rows are the department sections.
    groupedColumnMode: "remove",
    paginateExpandedRows: true,
    // Every save refreshes the data; collapsing all departments each time would
    // make the grid unusable, so expansion is never auto-reset.
    autoResetExpanded: false,
    autoResetAll: false,
  });

  const columnVisibility = useMemo(() => table.state.columnVisibility ?? {}, [table.state.columnVisibility]);
  const enabled = useMemo(
    () => enabledLocationIds(columnVisibility, availableLocations),
    [columnVisibility, availableLocations],
  );
  const cellColumns = table
    .getVisibleLeafColumns()
    .filter((c) => c.columnDef.meta?.kind === "cell");
  const leafHeaders = table.getLeafHeaders().filter((h) => h.column.columnDef.meta?.kind === "cell");
  const colCount = cellColumns.filter((c) => c.columnDef.meta?.kind === "cell" && c.columnDef.meta.day === 0).length;
  const span = 1 + DAYS.length * Math.max(colCount, 1);
  const tableRows = table.getRowModel().rows;

  // Actions and dialogs ------------------------------------------------------
  const runners = useGridActions(week.id);
  const [ui, patchUi] = useGridUiState();

  const contextValue = useMemo<GridContextValue>(
    () => ({
      week,
      isPublished,
      canEdit,
      templateMode,
      departmentById,
      personById,
      roleName,
      cellMap,
      weeklyCount,
      conflictReasons,
      weekTimeOff,
      systemAttendance,
      closureSet,
      eventMap,
      agendaCountMap,
      actions: {
        openPicker: (cell) => patchUi({ picker: cell }),
        openAttendance: (assignmentId) => patchUi({ attendanceId: assignmentId }),
        openLineModal: (opts) => patchUi({ lineModal: opts }),
        openDeptModal: (dept) => patchUi({ deptModal: { dept } }),
        openEventModal: (locationId, day, title) => patchUi({ eventModal: { locationId, day, title } }),
        toggleClosure: (locationId, day) => void runners.closure(locationId, day),
        removeAssignment: (assignmentId) => void runners.remove(assignmentId),
        moveAssignment: (assignmentId, lineId, locationId, day) =>
          void runners.move(assignmentId, lineId, locationId, day),
        removeLine: (line) => patchUi({ lineDelete: line }),
      },
    }),
    [
      week,
      isPublished,
      canEdit,
      templateMode,
      departmentById,
      personById,
      roleName,
      cellMap,
      weeklyCount,
      conflictReasons,
      weekTimeOff,
      systemAttendance,
      closureSet,
      eventMap,
      agendaCountMap,
      patchUi,
      runners,
    ],
  );

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
    const csvRows = buildWiwCsvRows({
      assignments,
      lines,
      roles: setup.roles,
      locations: setup.locations,
      personById,
      weekStart: week.week_start,
    });
    downloadCsvFile(`schedule-${week.week_start}-wheniwork.csv`, toCsvText(csvRows));
  };

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
    const tableEl = grid.querySelector("table");
    if (tableEl) observer.observe(tableEl);
    return () => observer.disconnect();
  }, [cellColumns.length, week.id]);

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
    <GridContext.Provider value={contextValue}>
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
          onToggleLocation={(id) =>
            table.setColumnVisibility((prev) => toggleLocationVisibility(prev, id))
          }
          templateMode={templateMode}
          templates={templates}
          onPrintGrid={() => setPrintMode("grid")}
          onPrintEmployee={() => setPrintMode("employee")}
          onExportCsv={downloadWiwCsv}
          onStatus={(status) =>
            runners.setStatus(status, (untimed, error) =>
              patchUi({ publishConfirm: { status, untimed, error } }),
            )
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
          <table className="min-w-full border-collapse text-xs" style={{ zoom: 0.85 }}>
            <GridHeader table={table} leafHeaders={leafHeaders} />
            <tbody>
              {!templateMode && (
                <PtoSection
                  colCount={colCount}
                  span={span}
                  collapsed={ptoCollapsed}
                  ptoByDay={ptoByDay}
                  weekCount={weekTimeOff.size}
                  canEdit={canEdit}
                  onToggle={() => setPtoCollapsed((v) => !v)}
                  onDecide={(chip, day) => patchUi({ ptoMenu: { chip, day } })}
                />
              )}
              {tableRows.map((row) =>
                row.getIsGrouped() ? (
                  <DeptSectionRow key={row.id} row={row} cellColumns={cellColumns} span={span} />
                ) : row.original.kind === "empty" ? (
                  <EmptyDeptRow key={row.id} row={row} span={span} />
                ) : (
                  <ShiftLineRow key={row.id} row={row} table={table} />
                ),
              )}
              {rows.length === 0 && (
                <NoLinesRow span={1 + DAYS.length} onLoadTemplate={() => void runners.loadDefaultTemplate()} />
              )}
            </tbody>
          </table>
        </div>

        <PerEmployeePrintout weekStart={week.week_start} employees={perEmployee} />

        <div className="flex items-center justify-between gap-3 print:hidden">
          <GridLegend />
          {canEdit && (
            <GridFooterActions
              showDefaultTemplate={week.status === "draft" && !templateMode}
              onLoadDefaultTemplate={() => void runners.loadDefaultTemplate()}
              onAddDepartment={() => patchUi({ deptModal: { dept: null } })}
              onAddLine={() => patchUi({ lineModal: { line: null } })}
            />
          )}
        </div>

        <GridDialogs
          ui={ui}
          patchUi={patchUi}
          lines={lines}
          assignments={assignments}
          setup={setup}
          availableLocations={availableLocations}
          membersByRole={membersByRole}
          scheduledByDay={scheduledByDay}
          runners={runners}
        />
      </div>
    </GridContext.Provider>
  );
}
