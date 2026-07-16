"use client";

import { useMemo, useState, useTransition } from "react";
import { PageHeader } from "../_components/ui";
import { gridName, timeRange, type SchedPerson } from "@/lib/schedule/types";
import { runScheduleSearch } from "./actions";
import type { ShiftHit } from "./data";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Local YYYY-MM-DD for a Date (avoids UTC off-by-one). */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** "Mon · Aug 4" style label for a work date. */
function formatDay(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: WEEKDAY[d.getDay()],
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

interface Slot {
  key: number;
  personId: string;
}

export function ScheduleSearchWorkspace({ people }: { people: SchedPerson[] }) {
  const today = useMemo(() => toISO(new Date()), []);
  const [slots, setSlots] = useState<Slot[]>([{ key: 0, personId: "" }]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => addDays(today, 28));
  const [results, setResults] = useState<ShiftHit[] | null>(null);
  const [searchedIds, setSearchedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  const selectedIds = useMemo(
    () => slots.map((s) => s.personId).filter(Boolean),
    [slots],
  );

  function updateSlot(key: number, personId: string) {
    setSlots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, personId } : s)),
    );
  }
  function addSlot() {
    setSlots((prev) => [
      ...prev,
      { key: (prev[prev.length - 1]?.key ?? 0) + 1, personId: "" },
    ]);
  }
  function removeSlot(key: number) {
    setSlots((prev) =>
      prev.length === 1
        ? [{ key: 0, personId: "" }]
        : prev.filter((s) => s.key !== key),
    );
  }

  const canSearch =
    selectedIds.length > 0 && !!startDate && !!endDate && startDate <= endDate;

  function onSearch() {
    if (!canSearch) return;
    const ids = [...new Set(selectedIds)];
    startTransition(async () => {
      const hits = await runScheduleSearch({
        personIds: ids,
        startDate,
        endDate,
      });
      setSearchedIds(ids);
      setResults(hits);
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Schedule Search"
        description="Pick one or more employees and a date range to see their upcoming scheduled workdays side by side. Days where selected employees share a location are highlighted."
      />

      <SearchControls
        people={people}
        slots={slots}
        selectedIds={selectedIds}
        startDate={startDate}
        endDate={endDate}
        canSearch={canSearch}
        isPending={isPending}
        onUpdateSlot={updateSlot}
        onAddSlot={addSlot}
        onRemoveSlot={removeSlot}
        onStartDate={setStartDate}
        onEndDate={setEndDate}
        onSearch={onSearch}
      />

      {results !== null ? (
        <Results
          hits={results}
          personIds={searchedIds}
          peopleById={peopleById}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
          Select employees and a date range, then hit Search to see their
          scheduled workdays.
        </div>
      )}
    </div>
  );
}

function SearchControls({
  people,
  slots,
  selectedIds,
  startDate,
  endDate,
  canSearch,
  isPending,
  onUpdateSlot,
  onAddSlot,
  onRemoveSlot,
  onStartDate,
  onEndDate,
  onSearch,
}: {
  people: SchedPerson[];
  slots: Slot[];
  selectedIds: string[];
  startDate: string;
  endDate: string;
  canSearch: boolean;
  isPending: boolean;
  onUpdateSlot: (key: number, personId: string) => void;
  onAddSlot: () => void;
  onRemoveSlot: (key: number) => void;
  onStartDate: (v: string) => void;
  onEndDate: (v: string) => void;
  onSearch: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Employees */}
        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Employees
          </label>
          <div className="space-y-2">
            {slots.map((slot) => {
              // Options: everyone not already chosen in another slot.
              const taken = new Set(
                selectedIds.filter((id) => id !== slot.personId),
              );
              return (
                <div key={slot.key} className="flex items-center gap-2">
                  <select
                    value={slot.personId}
                    onChange={(e) => onUpdateSlot(slot.key, e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Select an employee…</option>
                    {people
                      .filter((p) => !taken.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {gridName(p)}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemoveSlot(slot.key)}
                    aria-label="Remove employee"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onAddSlot}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
          >
            <span className="text-base leading-none">＋</span> Add employee
          </button>
        </div>

        {/* Date range + search */}
        <div className="flex flex-col gap-3 lg:min-w-[300px]">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => onStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                To
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => onEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onSearch}
            disabled={!canSearch || isPending}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Searching…" : "Search"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OverlapDay {
  date: string;
  locations: { locationId: string; locationName: string; personIds: string[] }[];
}

function Results({
  hits,
  personIds,
  peopleById,
}: {
  hits: ShiftHit[];
  personIds: string[];
  peopleById: Map<string, SchedPerson>;
}) {
  const { dates, byDatePerson, overlaps, alignedCells } = useMemo(() => {
    // Group shifts by date, then by person.
    const byDatePerson = new Map<string, Map<string, ShiftHit[]>>();
    const dateSet = new Set<string>();
    for (const h of hits) {
      dateSet.add(h.work_date);
      let perPerson = byDatePerson.get(h.work_date);
      if (!perPerson) {
        perPerson = new Map();
        byDatePerson.set(h.work_date, perPerson);
      }
      const list = perPerson.get(h.person_id);
      if (list) list.push(h);
      else perPerson.set(h.person_id, [h]);
    }
    const dates = [...dateSet].sort();

    // Overlaps: per date, locations where 2+ selected people are scheduled.
    const overlaps: OverlapDay[] = [];
    // Set of "date|person" cells that participate in an overlap.
    const alignedCells = new Set<string>();
    for (const date of dates) {
      const perPerson = byDatePerson.get(date)!;
      const byLocation = new Map<
        string,
        { locationName: string; personIds: Set<string> }
      >();
      for (const [personId, shifts] of perPerson) {
        for (const s of shifts) {
          let entry = byLocation.get(s.location_id);
          if (!entry) {
            entry = { locationName: s.location_name, personIds: new Set() };
            byLocation.set(s.location_id, entry);
          }
          entry.personIds.add(personId);
        }
      }
      const shared = [...byLocation.entries()].filter(
        ([, v]) => v.personIds.size >= 2,
      );
      if (shared.length > 0) {
        overlaps.push({
          date,
          locations: shared.map(([locationId, v]) => ({
            locationId,
            locationName: v.locationName,
            personIds: [...v.personIds],
          })),
        });
        for (const [, v] of shared) {
          for (const pid of v.personIds) alignedCells.add(`${date}|${pid}`);
        }
      }
    }

    return { dates, byDatePerson, overlaps, alignedCells };
  }, [hits]);

  const nameOf = (id: string) => {
    const p = peopleById.get(id);
    return p ? gridName(p) : "Unknown";
  };

  if (hits.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-700">
          No scheduled workdays found
        </p>
        <p className="mt-1 text-sm text-slate-500">
          No published or pending-approval shifts for the selected employees in
          this date range.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {personIds.length > 1 ? (
        <OverlapSummary overlaps={overlaps} nameOf={nameOf} />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Day
              </th>
              {personIds.map((id) => (
                <th
                  key={id}
                  className="min-w-[160px] px-4 py-3 text-[13px] font-semibold text-slate-700"
                >
                  {nameOf(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const perPerson = byDatePerson.get(date)!;
              const { weekday, date: label } = formatDay(date);
              const rowHasOverlap = personIds.some((id) =>
                alignedCells.has(`${date}|${id}`),
              );
              return (
                <tr
                  key={date}
                  className={`border-b border-slate-100 last:border-0 ${
                    rowHasOverlap ? "bg-emerald-50/40" : ""
                  }`}
                >
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-4 py-3 align-top">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {weekday}
                    </span>
                    <span className="block font-medium text-slate-800">
                      {label}
                    </span>
                  </td>
                  {personIds.map((id) => {
                    const shifts = perPerson.get(id) ?? [];
                    const aligned = alignedCells.has(`${date}|${id}`);
                    return (
                      <td key={id} className="px-4 py-3 align-top">
                        {shifts.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="space-y-1.5">
                            {shifts.map((s, i) => (
                              <ShiftChip key={i} shift={s} aligned={aligned} />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftChip({ shift, aligned }: { shift: ShiftHit; aligned: boolean }) {
  const time = timeRange(shift.start_time, shift.end_time);
  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 ${
        aligned
          ? "border-emerald-300 bg-emerald-100/70"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {shift.location_color ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: shift.location_color }}
            aria-hidden
          />
        ) : null}
        <span className="font-medium text-slate-800">{shift.location_name}</span>
      </div>
      {time ? (
        <span className="mt-0.5 block text-xs text-slate-500">{time}</span>
      ) : null}
    </div>
  );
}

function OverlapSummary({
  overlaps,
  nameOf,
}: {
  overlaps: OverlapDay[];
  nameOf: (id: string) => string;
}) {
  if (overlaps.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        No shared locations — the selected employees aren&apos;t scheduled at the
        same location on the same day in this range.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
      <p className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-emerald-800">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">
          ✓
        </span>
        {overlaps.length} shared{" "}
        {overlaps.length === 1 ? "day" : "days"} — good for meetings
      </p>
      <ul className="space-y-1.5">
        {overlaps.map((o) => {
          const { weekday, date } = formatDay(o.date);
          return (
            <li key={o.date} className="text-sm text-emerald-900">
              <span className="font-medium">
                {weekday}, {date}
              </span>
              {o.locations.map((loc) => (
                <span key={loc.locationId} className="ml-2 text-emerald-800">
                  · {loc.locationName}:{" "}
                  {loc.personIds.map(nameOf).join(", ")}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
