"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Location } from "@/lib/shared/locations";
import type { SchedDepartment, SchedWeek } from "@/lib/schedule/types";
import {
  APPOINTMENT_TYPES,
  COLUMN_PRESETS,
  DAY_LABELS,
  DAY_SHORT,
  GRID_STEP_MINUTES,
  apptChipStyle,
  apptType,
  bucketMarker,
  countBookable,
  displaySlotLabel,
  minutesToInput,
  minutesToLabel,
  parseMinutes,
  timeBuckets,
  weekdaysLabel,
  type GuideData,
  type PlanningGuide,
  type PlanningGuideColumn,
  type PlanningGuideSlot,
} from "@/lib/planning/types";
import {
  addColumn,
  addSlot,
  createGuide,
  deleteColumn,
  deleteGuide,
  deleteSlot,
  duplicateGuide,
  moveSlot,
  reorderColumns,
  updateColumn,
  updateGuide,
  updateSlot,
  type ActionResult,
} from "./actions";
import { PageHeader } from "../_components/ui";
import { WeekPicker } from "../schedule/week-picker";

interface Setup {
  locations: Location[];
  departments: SchedDepartment[];
}

type Fields = Record<string, string | number | null | undefined | (string | number)[]>;

function buildForm(fields: Fields): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, String(x)));
    else fd.append(k, String(v));
  }
  return fd;
}

/** A compact label of a guide's staffing key, e.g. "2 DVM · 3 Tech · 1 DA". */
function staffingKeyLabel(guide: PlanningGuide): string {
  const parts: string[] = [];
  if (guide.dvm_count != null) parts.push(`${guide.dvm_count} DVM`);
  if (guide.tech_count != null) parts.push(`${guide.tech_count} Tech`);
  if (guide.lead_count != null) parts.push(`${guide.lead_count} Lead`);
  if (guide.dental_count != null) parts.push(`${guide.dental_count} Dental`);
  if (guide.da_count != null) parts.push(`${guide.da_count} DA`);
  if (guide.float_count != null) parts.push(`${guide.float_count} Float`);
  return parts.length ? `${parts.join(" · ")} staffing key` : "Manual only";
}

// ---------------------------------------------------------------------------
// Workspace shell
// ---------------------------------------------------------------------------

export function PlanningWorkspace({
  guides,
  setup,
  guideData,
  weeks,
  selectedWeekId,
  canEdit,
}: {
  guides: PlanningGuide[];
  setup: Setup;
  guideData: GuideData | null;
  weeks: SchedWeek[];
  selectedWeekId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guideForm, setGuideForm] = useState<PlanningGuide | "new" | null>(null);

  const run = useCallback(
    (
      fn: (fd: FormData) => Promise<ActionResult<{ id: string }>> | Promise<ActionResult>,
      fields: Fields,
      after?: (data?: { id: string }) => void,
    ) => {
      setError(null);
      startTransition(async () => {
        const res = await fn(buildForm(fields));
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const data = "data" in res ? (res.data as { id: string } | undefined) : undefined;
        after?.(data);
        router.refresh();
      });
    },
    [router],
  );

  const selectGuide = useCallback(
    (id: string) => {
      router.push(`/planning?guide=${id}`, { scroll: false });
    },
    [router],
  );

  const locName = useMemo(() => {
    const m = new Map(setup.locations.map((l) => [l.id, l.display_name || l.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [setup.locations]);
  const deptName = useMemo(() => {
    const m = new Map(setup.departments.map((d) => [d.id, d.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [setup.departments]);

  // Reusable templates (no source week) show on every week; auto-generated
  // guides only appear on the week they were built for. The currently open
  // guide is always kept visible so deep links from Daily Capacity resolve.
  const selectedGuideId = guideData?.guide.id ?? null;
  const visibleGuides = useMemo(
    () =>
      guides.filter(
        (g) =>
          g.source_week_id == null ||
          g.source_week_id === selectedWeekId ||
          g.id === selectedGuideId,
      ),
    [guides, selectedWeekId, selectedGuideId],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling · Step 1"
        title="Planning Guides"
        description="Define the bookable appointment grid for each location and service. These guides drive how the weekly schedule is built."
        actions={
          canEdit ? (
            <button
              type="button"
              onClick={() => setGuideForm("new")}
              className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              + New Guide
            </button>
          ) : null
        }
      />

      <WeekPicker
        weeks={weeks}
        selectedId={selectedWeekId}
        basePath="/planning"
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <GuideList
          guides={visibleGuides}
          selectedId={guideData?.guide.id ?? null}
          onSelect={selectGuide}
          locName={locName}
          deptName={deptName}
        />

        <div className="min-w-0">
          {guideData ? (
            <GuideEditor
              key={guideData.guide.id}
              data={guideData}
              canEdit={canEdit}
              pending={pending}
              run={run}
              locName={locName}
              deptName={deptName}
              onEditGuide={() => setGuideForm(guideData.guide)}
            />
          ) : (
            <EmptyState canEdit={canEdit} onCreate={() => setGuideForm("new")} />
          )}
        </div>
      </div>

      {guideForm ? (
        <GuideFormDialog
          setup={setup}
          guide={guideForm === "new" ? null : guideForm}
          pending={pending}
          onClose={() => setGuideForm(null)}
          onSubmit={(fields) => {
            const isNew = guideForm === "new";
            run(isNew ? createGuide : updateGuide, fields, (data) => {
              setGuideForm(null);
              if (isNew && data?.id) selectGuide(data.id);
            });
          }}
          onDelete={
            guideForm === "new"
              ? undefined
              : () => {
                  if (!confirm("Delete this planning guide and all its slots?")) return;
                  run(deleteGuide, { id: (guideForm as PlanningGuide).id }, () => {
                    setGuideForm(null);
                    router.push("/planning", { scroll: false });
                  });
                }
          }
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guide list
// ---------------------------------------------------------------------------

function GuideList({
  guides,
  selectedId,
  onSelect,
  locName,
  deptName,
}: {
  guides: PlanningGuide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locName: (id: string | null) => string | null;
  deptName: (id: string | null) => string | null;
}) {
  const groups = useMemo(() => {
    const byLoc = new Map<string, PlanningGuide[]>();
    for (const g of guides) {
      const key = locName(g.location_id) ?? "Other Services";
      const arr = byLoc.get(key) ?? [];
      arr.push(g);
      byLoc.set(key, arr);
    }
    // Guides within each location: ascending by name (active before archived).
    for (const arr of byLoc.values()) {
      arr.sort(
        (a, b) =>
          a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
      );
    }
    // Location group headers: alphabetical descending.
    return [...byLoc.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [guides, locName]);

  // Location groups start collapsed; the group holding the selected guide is
  // expanded so the current guide stays visible.
  const selectedLoc = useMemo(() => {
    const g = guides.find((x) => x.id === selectedId);
    return g ? locName(g.location_id) ?? "Other Services" : null;
  }, [guides, selectedId, locName]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = useCallback((loc: string) => {
    setCollapsed((prev) => ({ ...prev, [loc]: !(prev[loc] ?? true) }));
  }, []);

  if (!guides.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        No planning guides yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([loc, list]) => {
        const isCollapsed = collapsed[loc] ?? loc !== selectedLoc;
        return (
        <div key={loc}>
          <button
            type="button"
            onClick={() => toggleGroup(loc)}
            aria-expanded={!isCollapsed}
            className="flex w-full items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-slate-600"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z"
                clipRule="evenodd"
              />
            </svg>
            <span className="truncate">{loc}</span>
            <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              {list.length}
            </span>
          </button>
          {isCollapsed ? null : (
          <div className="space-y-1.5">
            {list.map((g) => {
              const active = g.id === selectedId;
              const sub = [deptName(g.department_id) ?? g.service_label, g.day_model]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelect(g.id)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">
                      {g.name}
                    </span>
                    {g.status === "archived" ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                        Archived
                      </span>
                    ) : g.auto_generated ? (
                      <span
                        className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700"
                        title="Auto-generated from a Daily Capacity tile for this week — editable"
                      >
                        Auto
                      </span>
                    ) : null}
                  </div>
                  {sub ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {weekdaysLabel(g.weekdays)} · {minutesToLabel(g.start_minute)}–
                    {minutesToLabel(g.end_minute)}
                  </p>
                </button>
              );
            })}
          </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guide editor (grid)
// ---------------------------------------------------------------------------

type SlotEdit =
  | { mode: "new"; columnId: string; startMinute: number }
  | { mode: "edit"; slot: PlanningGuideSlot }
  | null;

function GuideEditor({
  data,
  canEdit,
  pending,
  run,
  locName,
  deptName,
  onEditGuide,
}: {
  data: GuideData;
  canEdit: boolean;
  pending: boolean;
  run: (
    fn: (fd: FormData) => Promise<ActionResult<{ id: string }>> | Promise<ActionResult>,
    fields: Fields,
    after?: (data?: { id: string }) => void,
  ) => void;
  locName: (id: string | null) => string | null;
  deptName: (id: string | null) => string | null;
  onEditGuide: () => void;
}) {
  const { guide, columns, slots } = data;
  const router = useRouter();
  const buckets = useMemo(() => timeBuckets(guide), [guide]);
  const [slotEdit, setSlotEdit] = useState<SlotEdit>(null);
  const [columnEdit, setColumnEdit] = useState<PlanningGuideColumn | "new" | null>(
    null,
  );
  const [dragSlot, setDragSlot] = useState<PlanningGuideSlot | null>(null);
  const [dropCell, setDropCell] = useState<string | null>(null);

  const handleSlotDrop = useCallback(
    (columnId: string, bucket: number) => {
      setDropCell(null);
      const s = dragSlot;
      setDragSlot(null);
      if (!s) return;
      if (s.column_id === columnId && s.start_minute === bucket) return;
      run(moveSlot, { id: s.id, column_id: columnId, start_minute: bucket });
    },
    [dragSlot, run],
  );

  // index slots by column + bucket (rows are fixed 15-minute windows)
  const slotsByCell = useMemo(() => {
    const step = GRID_STEP_MINUTES;
    const map = new Map<string, PlanningGuideSlot[]>();
    for (const s of slots) {
      const bucket =
        guide.start_minute +
        Math.floor((s.start_minute - guide.start_minute) / step) * step;
      const key = `${s.column_id}:${bucket}`;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.start_minute - b.start_minute || a.sort_order - b.sort_order);
    }
    return map;
  }, [slots, guide.start_minute]);

  const subtitle = [
    locName(guide.location_id),
    deptName(guide.department_id) ?? guide.service_label,
    guide.day_model,
  ]
    .filter(Boolean)
    .join(" · ");

  // Tally of appointment types on this day (excludes empty "open" slots),
  // ordered by the canonical appointment-type palette.
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of slots) {
      if (s.type_code === "open") continue;
      counts.set(s.type_code, (counts.get(s.type_code) ?? 0) + 1);
    }
    return APPOINTMENT_TYPES.filter((t) => counts.has(t.code)).map((t) => ({
      type: t,
      count: counts.get(t.code) ?? 0,
    }));
  }, [slots]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            {guide.name}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-400">
            {weekdaysLabel(guide.weekdays)} · {minutesToLabel(guide.start_minute)}–
            {minutesToLabel(guide.end_minute)} · {guide.slot_minutes}-min slots ·{" "}
            <span className="font-medium text-slate-500">
              {countBookable(slots)} bookable slots
            </span>
            {guide.dvm_count != null ? (
              <>
                {" · "}
                <span className="font-medium text-emerald-600">
                  {staffingKeyLabel(guide)}
                </span>
              </>
            ) : null}
          </p>
          {typeCounts.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {typeCounts.map(({ type, count }) => (
                <span
                  key={type.code}
                  style={apptChipStyle(type.color)}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold"
                  title={`${type.label}: ${count}`}
                >
                  {type.short}
                  <span className="rounded bg-white/70 px-1 text-[10px] font-bold tabular-nums">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setColumnEdit("new")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              + Column
            </button>
            <button
              type="button"
              onClick={() =>
                run(duplicateGuide, { id: guide.id }, (d) => {
                  if (d?.id) router.push(`/planning?guide=${d.id}`, { scroll: false });
                })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={onEditGuide}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  !confirm(
                    `Delete "${guide.name}" and all its columns and slots? This cannot be undone.`,
                  )
                )
                  return;
                run(deleteGuide, { id: guide.id }, () => {
                  router.push("/planning", { scroll: false });
                });
              }}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {/* Grid */}
      {columns.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500">
          No appointment tracks yet.{" "}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setColumnEdit("new")}
              className="font-medium text-emerald-600 hover:underline"
            >
              Add the first column
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto p-2">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-14 bg-slate-50 px-2 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Time
                </th>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className="border-b-2 border-slate-200 bg-slate-50 px-2 py-2 text-left align-top"
                    style={{ minWidth: 150, borderTop: `3px solid ${col.color}` }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: col.color }}
                          />
                          <span className="truncate font-semibold text-slate-700">
                            {col.name}
                          </span>
                        </div>
                        {col.capacity_note ? (
                          <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">
                            {col.capacity_note}
                          </p>
                        ) : null}
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setColumnEdit(col)}
                          className="shrink-0 rounded px-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                          title="Edit column"
                        >
                          ⋯
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => {
                const marker = bucketMarker(bucket);
                const rowBorder =
                  marker === "hour"
                    ? "border-t-2 border-slate-300"
                    : marker === "half"
                      ? "border-t border-slate-200"
                      : "border-t border-dashed border-slate-100";
                const timeText =
                  marker === "hour"
                    ? "text-[13px] font-bold text-slate-600"
                    : marker === "half"
                      ? "text-xs font-semibold text-slate-400"
                      : "text-[10px] font-medium text-slate-300";
                return (
                  <tr key={bucket} className="align-top">
                    <td
                      className={`sticky left-0 z-10 bg-white px-2 py-1 text-right tabular-nums ${rowBorder} ${timeText}`}
                    >
                      {minutesToLabel(bucket)}
                    </td>
                    {columns.map((col) => {
                      const cellSlots = slotsByCell.get(`${col.id}:${bucket}`) ?? [];
                      const cellKey = `${col.id}:${bucket}`;
                      const isDropTarget = canEdit && dropCell === cellKey;
                      return (
                        <td
                          key={col.id}
                          onDragOver={
                            canEdit && dragSlot
                              ? (e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (dropCell !== cellKey) setDropCell(cellKey);
                                }
                              : undefined
                          }
                          onDragLeave={
                            canEdit && dragSlot
                              ? (e) => {
                                  if (
                                    !e.currentTarget.contains(
                                      e.relatedTarget as Node | null,
                                    )
                                  ) {
                                    setDropCell((c) => (c === cellKey ? null : c));
                                  }
                                }
                              : undefined
                          }
                          onDrop={
                            canEdit && dragSlot
                              ? (e) => {
                                  e.preventDefault();
                                  handleSlotDrop(col.id, bucket);
                                }
                              : undefined
                          }
                          className={`group border-l border-slate-100 px-1.5 py-1 transition ${rowBorder} ${
                            isDropTarget
                              ? "bg-emerald-50 ring-2 ring-inset ring-emerald-300"
                              : "hover:bg-slate-50/60"
                          }`}
                        >
                          <div className="flex min-h-[1.5rem] flex-col gap-1">
                            {cellSlots.map((s) => (
                              <SlotChip
                                key={s.id}
                                slot={s}
                                canEdit={canEdit}
                                dragging={dragSlot?.id === s.id}
                                onDragStart={() => setDragSlot(s)}
                                onDragEnd={() => {
                                  setDragSlot(null);
                                  setDropCell(null);
                                }}
                                onClick={() =>
                                  canEdit && setSlotEdit({ mode: "edit", slot: s })
                                }
                              />
                            ))}
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setSlotEdit({
                                    mode: "new",
                                    columnId: col.id,
                                    startMinute: bucket,
                                  })
                                }
                                className="rounded border border-dashed border-transparent px-1.5 py-0.5 text-left text-[11px] text-slate-300 opacity-0 transition hover:border-emerald-300 hover:text-emerald-500 focus:opacity-100 group-hover:opacity-100"
                              >
                                + add
                              </button>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ApptLegend />

      {slotEdit ? (
        <SlotDialog
          guideId={guide.id}
          slotMinutes={guide.slot_minutes}
          edit={slotEdit}
          pending={pending}
          onClose={() => setSlotEdit(null)}
          onSubmit={(fields, isNew) => {
            run(isNew ? addSlot : updateSlot, fields, () => setSlotEdit(null));
          }}
          onDelete={
            slotEdit.mode === "edit"
              ? () =>
                  run(deleteSlot, { id: slotEdit.slot.id }, () => setSlotEdit(null))
              : undefined
          }
        />
      ) : null}

      {columnEdit ? (
        <ColumnDialog
          guideId={guide.id}
          column={columnEdit === "new" ? null : columnEdit}
          nextSort={columns.length * 10}
          pending={pending}
          onClose={() => setColumnEdit(null)}
          onSubmit={(fields, isNew) => {
            run(isNew ? addColumn : updateColumn, fields, () => setColumnEdit(null));
          }}
          onDelete={
            columnEdit === "new"
              ? undefined
              : () => {
                  if (!confirm("Delete this column and its slots?")) return;
                  run(deleteColumn, { id: (columnEdit as PlanningGuideColumn).id }, () =>
                    setColumnEdit(null),
                  );
                }
          }
          onMove={
            columnEdit === "new"
              ? undefined
              : (dir) => {
                  const idx = columns.findIndex(
                    (c) => c.id === (columnEdit as PlanningGuideColumn).id,
                  );
                  const other = columns[idx + dir];
                  if (!other) return;
                  const self = columns[idx];
                  run(
                    reorderColumns,
                    {
                      a_id: self.id,
                      b_id: other.id,
                      a_sort: self.sort_order,
                      b_sort: other.sort_order,
                    },
                    () => setColumnEdit(null),
                  );
                }
          }
        />
      ) : null}
    </div>
  );
}

function SlotChip({
  slot,
  canEdit,
  onClick,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  slot: PlanningGuideSlot;
  canEdit: boolean;
  onClick: () => void;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const t = apptType(slot.type_code);
  const display = displaySlotLabel(slot.label);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canEdit}
      draggable={canEdit}
      onDragStart={
        canEdit
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", slot.id);
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={canEdit ? () => onDragEnd?.() : undefined}
      style={apptChipStyle(t.color)}
      className={`rounded border px-1.5 py-0.5 text-left text-xs font-medium leading-tight ${
        canEdit ? "cursor-grab hover:brightness-95 active:cursor-grabbing" : "cursor-default"
      } ${dragging ? "opacity-40" : ""}`}
      title={`${t.label}${display ? ` — ${display}` : ""}`}
    >
      <span className="block truncate">
        {display || t.short}
        {display ? (
          <span className="ml-1 opacity-60">{t.short}</span>
        ) : null}
      </span>
    </button>
  );
}

function ApptLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Legend
      </span>
      {APPOINTMENT_TYPES.filter((t) => t.code !== "open").map((t) => (
        <span
          key={t.code}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500"
        >
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: t.color }}
          />
          {t.short}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  canEdit,
  onCreate,
}: {
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <span className="mb-3 text-3xl">🧭</span>
      <p className="text-sm font-medium text-slate-600">No guide selected</p>
      <p className="mt-1 max-w-sm text-sm text-slate-400">
        Pick a planning guide from the list, or create one to map out the bookable
        appointment grid for a location or service.
      </p>
      {canEdit ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          + New Guide
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const labelClass = "block text-xs font-semibold text-slate-500";

// ---------------------------------------------------------------------------
// Guide form dialog
// ---------------------------------------------------------------------------

function GuideFormDialog({
  setup,
  guide,
  pending,
  onClose,
  onSubmit,
  onDelete,
}: {
  setup: Setup;
  guide: PlanningGuide | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (fields: Fields) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(guide?.name ?? "");
  const [locationId, setLocationId] = useState(guide?.location_id ?? "");
  const [departmentId, setDepartmentId] = useState(guide?.department_id ?? "");
  const [serviceLabel, setServiceLabel] = useState(guide?.service_label ?? "");
  const [dayModel, setDayModel] = useState(guide?.day_model ?? "");
  const [dvmCount, setDvmCount] = useState(
    guide?.dvm_count != null ? String(guide.dvm_count) : "",
  );
  const [techCount, setTechCount] = useState(
    guide?.tech_count != null ? String(guide.tech_count) : "",
  );
  const [leadCount, setLeadCount] = useState(
    guide?.lead_count != null ? String(guide.lead_count) : "",
  );
  const [dentalCount, setDentalCount] = useState(
    guide?.dental_count != null ? String(guide.dental_count) : "",
  );
  const [daCount, setDaCount] = useState(
    guide?.da_count != null ? String(guide.da_count) : "",
  );
  const [floatCount, setFloatCount] = useState(
    guide?.float_count != null ? String(guide.float_count) : "",
  );
  const [weekdays, setWeekdays] = useState<number[]>(guide?.weekdays ?? []);
  const [start, setStart] = useState(minutesToInput(guide?.start_minute ?? 540));
  const [end, setEnd] = useState(minutesToInput(guide?.end_minute ?? 1020));
  const [interval, setInterval] = useState(String(guide?.slot_minutes ?? 30));
  const [status, setStatus] = useState(guide?.status ?? "active");
  const [notes, setNotes] = useState(guide?.notes ?? "");

  const toggleDay = (d: number) =>
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );

  const submit = () => {
    const startMin = parseMinutes(start);
    const endMin = parseMinutes(end);
    onSubmit({
      id: guide?.id,
      name,
      location_id: locationId || undefined,
      department_id: departmentId || undefined,
      service_label: serviceLabel || undefined,
      day_model: dayModel || undefined,
      weekdays,
      dvm_count: dvmCount || undefined,
      tech_count: techCount === "" ? undefined : techCount,
      lead_count: leadCount === "" ? undefined : leadCount,
      dental_count: dentalCount === "" ? undefined : dentalCount,
      da_count: daCount === "" ? undefined : daCount,
      float_count: floatCount === "" ? undefined : floatCount,
      start_minute: startMin ?? 540,
      end_minute: endMin ?? 1020,
      slot_minutes: interval,
      status,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog
      title={guide ? "Guide settings" : "New planning guide"}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="mr-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {guide ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className={labelClass}>Name</label>
          <input
            className={`mt-1 ${fieldClass}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Venice — Mon/Wed Vet Exam Heavy"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Location</label>
            <select
              className={`mt-1 ${fieldClass}`}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">— Service site —</option>
              {setup.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.display_name || l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Department</label>
            <select
              className={`mt-1 ${fieldClass}`}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">— None —</option>
              {setup.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Service label (optional)</label>
            <input
              className={`mt-1 ${fieldClass}`}
              value={serviceLabel}
              onChange={(e) => setServiceLabel(e.target.value)}
              placeholder="Internal Medicine"
            />
          </div>
          <div>
            <label className={labelClass}>Day model (optional)</label>
            <input
              className={`mt-1 ${fieldClass}`}
              value={dayModel}
              onChange={(e) => setDayModel(e.target.value)}
              placeholder="Dental heavy day"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Applies on</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DAY_SHORT.map((d, i) => {
              const on = weekdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  title={DAY_LABELS[i]}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                    on
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={labelClass}>Staffing key — DVMs (optional)</label>
          <select
            className={`mt-1 ${fieldClass}`}
            value={dvmCount}
            onChange={(e) => setDvmCount(e.target.value)}
          >
            <option value="">— Manual only —</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} DVM{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            The schedule auto-selects this guide when this many doctors are
            staffed for the matching location &amp; department on a given day.
          </p>
        </div>

        <div>
          <label className={labelClass}>
            Support staffing key (optional)
          </label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            {(
              [
                ["Tech", techCount, setTechCount],
                ["Lead", leadCount, setLeadCount],
                ["Dental", dentalCount, setDentalCount],
                ["DA", daCount, setDaCount],
                ["Float", floatCount, setFloatCount],
              ] as const
            ).map(([label, value, setValue]) => (
              <div key={label}>
                <span className="block text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  inputMode="numeric"
                  placeholder="any"
                  className={`mt-0.5 ${fieldClass} text-center`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Leave blank to ignore a role. When set, the schedule prefers a guide
            whose support headcount (location-wide) best matches the day.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Start</label>
            <input
              type="time"
              className={`mt-1 ${fieldClass}`}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>End</label>
            <input
              type="time"
              className={`mt-1 ${fieldClass}`}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Row interval</label>
            <select
              className={`mt-1 ${fieldClass}`}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            >
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">60 min</option>
            </select>
          </div>
        </div>

        {guide ? (
          <div>
            <label className={labelClass}>Status</label>
            <select
              className={`mt-1 ${fieldClass}`}
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "archived")}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        ) : null}

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            className={`mt-1 ${fieldClass}`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Column dialog
// ---------------------------------------------------------------------------

function ColumnDialog({
  guideId,
  column,
  nextSort,
  pending,
  onClose,
  onSubmit,
  onDelete,
  onMove,
}: {
  guideId: string;
  column: PlanningGuideColumn | null;
  nextSort: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (fields: Fields, isNew: boolean) => void;
  onDelete?: () => void;
  onMove?: (dir: -1 | 1) => void;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [color, setColor] = useState(column?.color ?? "#2563eb");
  const [capacity, setCapacity] = useState(column?.capacity_note ?? "");

  const submit = () =>
    onSubmit(
      {
        id: column?.id,
        guide_id: guideId,
        name,
        color,
        capacity_note: capacity || undefined,
        sort_order: column?.sort_order ?? nextSort,
      },
      !column,
    );

  return (
    <Dialog
      title={column ? "Edit column" : "Add appointment track"}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="mr-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {column ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        {!column ? (
          <div>
            <label className={labelClass}>Quick presets</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COLUMN_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setName(p.name);
                    setColor(p.color);
                    setCapacity(p.capacity_note ?? "");
                  }}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label className={labelClass}>Track name</label>
          <input
            className={`mt-1 ${fieldClass}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NAD / Clinic"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-[auto_1fr] items-end gap-3">
          <div>
            <label className={labelClass}>Color</label>
            <input
              type="color"
              className="mt-1 h-10 w-16 cursor-pointer rounded-lg border border-slate-300"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Capacity note (optional)</label>
            <input
              className={`mt-1 ${fieldClass}`}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="14 NADs / OEs"
            />
          </div>
        </div>

        {onMove ? (
          <div className="flex gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={pending}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              ← Move left
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={pending}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Move right →
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Slot dialog
// ---------------------------------------------------------------------------

function SlotDialog({
  guideId,
  slotMinutes,
  edit,
  pending,
  onClose,
  onSubmit,
  onDelete,
}: {
  guideId: string;
  slotMinutes: number;
  edit: NonNullable<SlotEdit>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (fields: Fields, isNew: boolean) => void;
  onDelete?: () => void;
}) {
  const isNew = edit.mode === "new";
  const slot = edit.mode === "edit" ? edit.slot : null;
  const [typeCode, setTypeCode] = useState(slot?.type_code ?? "nad");
  const [label, setLabel] = useState(slot?.label ?? "");
  const [duration, setDuration] = useState(
    String(slot?.duration_minutes ?? slotMinutes),
  );

  const submit = () =>
    onSubmit(
      {
        id: slot?.id,
        guide_id: guideId,
        column_id: isNew ? edit.columnId : slot?.column_id,
        start_minute: isNew ? edit.startMinute : slot?.start_minute,
        duration_minutes: duration,
        type_code: typeCode,
        label: label || undefined,
      },
      isNew,
    );

  return (
    <Dialog
      title={isNew ? "Add appointment slot" : "Edit slot"}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="mr-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {isNew ? "Add" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className={labelClass}>Appointment type</label>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {APPOINTMENT_TYPES.map((t) => {
              const on = t.code === typeCode;
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setTypeCode(t.code)}
                  style={on ? apptChipStyle(t.color) : undefined}
                  className={`rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition ${
                    on
                      ? "ring-1"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="truncate">{t.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Label (optional)</label>
            <input
              className={`mt-1 ${fieldClass}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VE (no time needed)"
            />
          </div>
          <div>
            <label className={labelClass}>Duration</label>
            <select
              className={`mt-1 ${fieldClass}`}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="15">15 min</option>
              <option value="20">20 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
            </select>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
