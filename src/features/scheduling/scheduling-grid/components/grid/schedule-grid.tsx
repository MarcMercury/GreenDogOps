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
import { GridPageHeader } from "@/features/scheduling/scheduling-grid/components/grid/grid-page-header";
import { GridToolbar } from "@/features/scheduling/scheduling-grid/components/grid/grid-toolbar";
import { NoLinesRow } from "@/features/scheduling/scheduling-grid/components/grid/no-lines-row";
import { ShiftLineRow } from "@/features/scheduling/scheduling-grid/components/grid/shift-line-row";
import { TemplateHeading } from "@/features/scheduling/scheduling-grid/components/grid/template-heading";
import { LocationToggles } from "@/features/scheduling/scheduling-grid/components/location-toggles";
import { PerEmployeePrintout } from "@/features/scheduling/scheduling-grid/components/per-employee-printout";
import { PtoSection } from "@/features/scheduling/scheduling-grid/components/pto-section";
import { ReadOnlyNotice } from "@/features/scheduling/scheduling-grid/components/read-only-notice";
import { SchedulePageShell } from "@/features/scheduling/scheduling-grid/components/schedule-page-shell";
import { RowsCard } from "@/features/scheduling/scheduling-grid/components/sidebar/rows-card";
import { WeeksCard } from "@/features/scheduling/scheduling-grid/components/sidebar/weeks-card";
import { UnpublishedBanner } from "@/features/scheduling/scheduling-grid/components/unpublished-banner";
import { GridContext } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { useGridActions } from "@/features/scheduling/scheduling-grid/hooks/use-grid-actions";
import { useGridUiState } from "@/features/scheduling/scheduling-grid/hooks/use-grid-ui-state";
import { useRowVisibility } from "@/features/scheduling/scheduling-grid/hooks/use-row-visibility";
import { useSectionTransitions } from "@/features/scheduling/scheduling-grid/hooks/use-section-transitions";
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
import {
  PTO_ROW_ID,
  applyRowVisibility,
  departmentsForRowsCard,
  rowVisibilityCounts,
} from "@/features/scheduling/scheduling-grid/lib/row-visibility";
import { neighborWeeks, sortWeeksAscending } from "@/features/scheduling/scheduling-grid/lib/week-calendar";
import type { AgendaCount } from "@/features/scheduling/scheduling-grid/types/agenda-count";
import type { GridTimeOffRow } from "@/features/scheduling/scheduling-grid/types/grid";
import type { GridContextValue } from "@/features/scheduling/scheduling-grid/types/grid-context";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";

/**
 * The weekly grid, as a TanStack Table: shift lines are the rows, grouped by
 * department (each department a collapsible group row), and the columns are
 * Sunday–Saturday, each a group of the available locations; which locations
 * show is the table's column visibility, which rows show is the Rows card's
 * filter. The PTO overview sits above the groups. On the schedule page the
 * grid sits beside the Weeks / Rows sidebar; on Set Up ▸ Week Template it
 * stands alone. This component owns the data lookups, the table instance, the
 * section open/close animation and the dialog state; the column definitions
 * live in `columns/`, the renderers read everything else through `GridContext`.
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

  // The schedule weeks (never the templates), oldest first, for ‹ › and the calendar.
  const scheduleWeeks = useMemo(() => sortWeeksAscending(weeks.filter((w) => !w.is_template)), [weeks]);
  const { prev, next } = useMemo(() => neighborWeeks(scheduleWeeks, week.id), [scheduleWeeks, week.id]);

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

  // The rows ----------------------------------------------------------------
  // Everything on the week, then what the Rows card has not hidden.
  const allRows = useMemo(
    () => buildGridRows({ lines, departments: setup.departments, templateMode, agendaDeptIds }),
    [lines, setup.departments, templateMode, agendaDeptIds],
  );
  const visibility = useRowVisibility();
  const rows = useMemo(() => applyRowVisibility(allRows, visibility.hidden), [allRows, visibility.hidden]);
  const withPto = !templateMode;
  const showPto = withPto && !visibility.hidden.departments.has(PTO_ROW_ID);
  const rowsCardDepartments = useMemo(
    () => departmentsForRowsCard(allRows, departmentById),
    [allRows, departmentById],
  );
  const rowCounts = useMemo(
    () => rowVisibilityCounts(allRows, visibility.hidden, { withPto }),
    [allRows, visibility.hidden, withPto],
  );
  const allSectionIds = useMemo(
    () => [...(withPto ? [PTO_ROW_ID] : []), ...rowsCardDepartments.map((d) => d.dept.id)],
    [withPto, rowsCardDepartments],
  );

  // The table ----------------------------------------------------------------
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

  // Sections open and close with an animation: a closing section keeps its
  // rows until the animation ends, then the state change removes them.
  const { expand: expandSection, collapse: collapseSection, stateOf: sectionState } = useSectionTransitions();
  const [ptoCollapsed, setPtoCollapsed] = useState(false);
  const togglePto = () => {
    if (ptoCollapsed) expandSection(PTO_ROW_ID, () => setPtoCollapsed(false));
    else collapseSection(PTO_ROW_ID, () => setPtoCollapsed(true));
  };

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
      sectionState,
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
        toggleDepartment: (row) => {
          const key = String(row.groupingValue);
          if (row.getIsExpanded()) collapseSection(key, () => row.toggleExpanded(false));
          else expandSection(key, () => row.toggleExpanded(true));
        },
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
      sectionState,
      collapseSection,
      expandSection,
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

  const onStatus = (status: SchedWeek["status"]) =>
    runners.setStatus(status, (untimed, error) => patchUi({ publishConfirm: { status, untimed, error } }));

  const page = (
    <div className={`space-y-4 ${printMode === "employee" ? "sched-print-employee" : "sched-print-grid"}`}>
      {!canEdit && <ReadOnlyNotice />}
      {templateMode ? <TemplateHeading /> : <GridPageHeader week={week} prev={prev} next={next} />}
      {!templateMode && (
        <div className="space-y-3 print:hidden">
          <GridToolbar
            week={week}
            templates={templates}
            canEdit={canEdit}
            onStatus={onStatus}
            onPrintGrid={() => setPrintMode("grid")}
            onPrintEmployee={() => setPrintMode("employee")}
            onExportCsv={downloadWiwCsv}
          />
          <UnpublishedBanner weekStart={week.week_start} status={week.status} />
        </div>
      )}
      <div className="print:hidden">
        <LocationToggles
          availableLocations={availableLocations}
          enabled={enabled}
          onToggle={(id) => table.setColumnVisibility((prev) => toggleLocationVisibility(prev, id))}
        />
      </div>

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
            {showPto && (
              <PtoSection
                colCount={colCount}
                span={span}
                collapsed={ptoCollapsed}
                state={sectionState(PTO_ROW_ID)}
                ptoByDay={ptoByDay}
                weekCount={weekTimeOff.size}
                canEdit={canEdit}
                onToggle={togglePto}
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
            {allRows.length === 0 && (
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
  );

  return (
    <GridContext.Provider value={contextValue}>
      {templateMode ? (
        page
      ) : (
        <SchedulePageShell
          sidebar={
            <>
              {/* Keyed by week so the calendar's month follows the open week. */}
              <WeeksCard
                key={week.week_start}
                weeks={scheduleWeeks}
                selectedWeekStart={week.week_start}
                selectedId={week.id}
                canEdit={canEdit}
              />
              <RowsCard
                departments={rowsCardDepartments}
                withPto={withPto}
                hidden={visibility.hidden}
                counts={rowCounts}
                roleName={roleName}
                onToggleDepartment={visibility.toggleDepartment}
                onToggleLine={visibility.toggleLine}
                onShowAll={visibility.showAll}
                onHideAll={() => visibility.hideAll(allSectionIds)}
              />
            </>
          }
        >
          {page}
        </SchedulePageShell>
      )}
    </GridContext.Provider>
  );
}
