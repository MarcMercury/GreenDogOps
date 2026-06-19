"use client";

import { useMemo, useState, useTransition } from "react";
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
  dateForDay,
  formatWeekRange,
  gridName,
  timeRange,
  type AttendanceStatus,
  type SchedAssignment,
  type SchedDepartment,
  type SchedPerson,
  type SchedRole,
  type SchedWeek,
  type SchedWeekLine,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { WeekPicker } from "./week-picker";
import {
  assignPerson,
  removeAssignment,
  markAttendance,
  toggleClosure,
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

export function ScheduleGrid({
  weeks,
  weekData,
  setup,
}: {
  weeks: SchedWeek[];
  weekData: WeekData;
  setup: SetupData;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const { week, lines, weekLocations, closures, assignments } = weekData;
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
    const init = planLocationIds.size
      ? planLocationIds
      : new Set(availableLocations.slice(0, 1).map((l) => l.id));
    return new Set(init);
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

  const closureSet = useMemo(
    () => new Set(closures.map((c) => `${c.location_id}|${c.day_of_week}`)),
    [closures],
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
      .filter((d) => byDept.has(d.id));
    return order.map((d) => ({
      dept: d,
      lines: (byDept.get(d.id) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order,
      ),
    }));
  }, [lines, setup.departments]);

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

  const colCount = shownLocations.length;

  return (
    <div className="space-y-3">
      <Toolbar
        week={week}
        weeks={weeks}
        availableLocations={availableLocations}
        enabled={enabled}
        setEnabled={setEnabled}
        onStatus={(s) =>
          start(async () => {
            await setWeekStatus(week.id, s);
            router.refresh();
          })
        }
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm print:overflow-visible print:border-0 print:shadow-none">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-20 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Shift
              </th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  colSpan={Math.max(colCount, 1)}
                  className="border-b border-l border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
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
                    className="border-b border-l border-slate-200 bg-slate-50 px-2 py-1 text-center text-[10px] text-slate-400"
                  >
                    —
                  </th>
                ) : (
                  shownLocations.map((loc) => {
                    const closed = closureSet.has(`${loc.id}|${d}`);
                    return (
                      <th
                        key={`${d}-${loc.id}`}
                        className="border-b border-l border-slate-200 bg-slate-50 px-1.5 py-1 text-center"
                        style={{
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
                          className={`text-[10px] font-semibold ${
                            closed
                              ? "text-red-500 line-through"
                              : "text-slate-500 hover:text-emerald-600"
                          }`}
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
                onAddLine={() =>
                  setLineModal({ line: null, deptId: dept.id })
                }
                onEditDept={() => setDeptModal({ dept })}
              >
                {deptLines.map((line) => (
                  <tr key={line.id} className="group/line hover:bg-slate-50/40">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-1.5 text-left align-top"
                      style={{ borderLeft: `3px solid ${dept.color}` }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <span className="block text-[12px] font-medium text-slate-800">
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
                          className="border-b border-l border-slate-100 bg-slate-50/40"
                        />
                      ) : (
                        shownLocations.map((loc) => {
                          const closed = closureSet.has(`${loc.id}|${d}`);
                          const k = `${line.id}|${loc.id}|${d}`;
                          const cellAsgs = cellMap.get(k) ?? [];
                          return (
                            <Cell
                              key={`${d}-${loc.id}`}
                              closed={closed}
                              accent={loc.color ?? "#cbd5e1"}
                              assignments={cellAsgs}
                              personById={personById}
                              weeklyCount={weeklyCount}
                              isPublished={isPublished}
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
  onStatus,
}: {
  week: SchedWeek;
  weeks: SchedWeek[];
  availableLocations: ScheduleLocation[];
  enabled: Set<string>;
  setEnabled: (s: Set<string>) => void;
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
        <WorkflowButtons status={week.status} onStatus={onStatus} />
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
}: {
  status: SchedWeek["status"];
  onStatus: (s: SchedWeek["status"]) => void;
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
            onClick={() => window.print()}
            className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}
          >
            Print
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
// Department section header row
// ---------------------------------------------------------------------------

function DeptSection({
  dept,
  span,
  onAddLine,
  onEditDept,
  children,
}: {
  dept: SchedDepartment;
  span: number;
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
            <span className="flex-1">{dept.name}</span>
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
  assignments,
  personById,
  weeklyCount,
  isPublished,
  onAdd,
  onRemove,
  onAttendance,
}: {
  closed: boolean;
  accent: string;
  assignments: SchedAssignment[];
  personById: Map<string, SchedPerson>;
  weeklyCount: Map<string, number>;
  isPublished: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onAttendance: (id: string) => void;
}) {
  if (closed) {
    return (
      <td
        className="border-b border-l border-slate-100 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)] text-center align-middle"
        title="Location closed"
      >
        <span className="text-[9px] font-semibold uppercase text-slate-400">
          Closed
        </span>
      </td>
    );
  }
  const visible = assignments.filter((a) => !a.removed_post_publish);
  const removed = assignments.filter((a) => a.removed_post_publish);

  return (
    <td
      className="group border-b border-l border-slate-100 align-top"
      style={{ minWidth: 96, borderLeftColor: `${accent}33` }}
    >
      <div className="flex min-h-[34px] flex-col gap-0.5 p-1">
        {visible.map((a) => {
          const p = personById.get(a.person_id);
          const att = a.attendance_status;
          const marked = att !== "scheduled";
          return (
            <div
              key={a.id}
              className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
                marked ? ATTENDANCE_TONE[att] : "bg-slate-100 text-slate-700"
              } ${a.added_post_publish ? "ring-1 ring-sky-400" : ""}`}
            >
              <button
                onClick={() => isPublished && onAttendance(a.id)}
                className={`flex-1 truncate text-left ${isPublished ? "cursor-pointer hover:underline" : ""}`}
                title={p ? gridName(p) : ""}
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

  // People eligible for this shift before role/search filters apply.
  const baseEligible = useMemo(() => {
    const roleMembers = line.role_id ? membersByRole.get(line.role_id) : null;
    return people.filter((p) => {
      const s = settingByPerson.get(p.id);
      if (s && !s.is_schedulable) return false;
      if (roleMembers && !roleMembers.has(p.id)) return false;
      return true;
    });
  }, [people, line.role_id, membersByRole, settingByPerson]);

  // Quick-filter chips: only roles represented among eligible people.
  const availableRoles = useMemo(() => {
    const ids = new Set<string>();
    for (const p of baseEligible) {
      const r = rolesByPerson.get(p.id);
      if (r) for (const id of r) ids.add(id);
    }
    return roles
      .filter((r) => ids.has(r.id))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [baseEligible, rolesByPerson, roles]);

  const eligible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return baseEligible
      .filter((p) => {
        if (roleFilter && !rolesByPerson.get(p.id)?.has(roleFilter))
          return false;
        if (term && !gridName(p).toLowerCase().includes(term)) return false;
        return true;
      })
      .sort((a, b) => {
        const ca = weeklyCount.get(a.id) ?? 0;
        const cb = weeklyCount.get(b.id) ?? 0;
        if (ca !== cb) return ca - cb; // least-loaded first
        return gridName(a).localeCompare(gridName(b));
      });
  }, [baseEligible, roleFilter, rolesByPerson, q, weeklyCount]);

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
                  key={r.id}
                  onClick={() =>
                    setRoleFilter((cur) => (cur === r.id ? null : r.id))
                  }
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                    roleFilter === r.id
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
                {ATTENDANCE_LABELS[assignment.attendance_status]}
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
            Reset to Scheduled
          </button>
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
