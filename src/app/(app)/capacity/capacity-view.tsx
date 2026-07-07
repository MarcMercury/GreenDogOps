"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DAY_LABELS } from "@/lib/schedule/types";
import type { DayLocationCapacity } from "@/lib/planning/resolve";
import { STAFF_CATEGORIES } from "@/lib/planning/resolve";
import { generateGuideFromCapacity } from "../schedule/actions";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

interface LocLite {
  id: string;
  name: string | null;
  short_code: string | null;
}

/**
 * Daily Capacity — each staffed area's appointment capacity for the week. The
 * schedule is authored first; this surfaces the capacity that follows from it
 * (from the matching capacity rule, else the guide's bookable slots) alongside
 * a link to the resolved planning guide when one exists.
 */
export function CapacityView({
  cells,
  locations,
  weekId,
  canEdit,
}: {
  cells: DayLocationCapacity[];
  locations: LocLite[];
  weekId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const byKey = useMemo(
    () => new Map(cells.map((c) => [`${c.day}|${c.locationId}`, c])),
    [cells],
  );
  const orderedLocations = useMemo(
    () => locations.filter((l) => cells.some((c) => c.locationId === l.id)),
    [locations, cells],
  );

  function generate(
    day: number,
    locationId: string,
    departmentId: string,
    target: number,
  ) {
    startTransition(async () => {
      const res = await generateGuideFromCapacity(
        weekId,
        day,
        locationId,
        departmentId,
        target,
      );
      if (res.ok && res.data) {
        router.push(`/planning?guide=${res.data.id}&week=${weekId}`);
      }
    });
  }

  if (cells.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-500">
          No staffing found for this week yet. Build the schedule first — each
          day&apos;s capacity and matching guide follow from how the day is
          staffed (DVMs, Techs, Leads, Dentals, DAs and Floats).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {DAYS.map((d) => {
          const dayCells = orderedLocations
            .map((loc) => ({ loc, cell: byKey.get(`${d}|${loc.id}`) }))
            .filter((x) => x.cell);
          return (
            <div key={d} className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {DAY_LABELS[d]}
              </div>
              {dayCells.length === 0 ? (
                <div className="text-[11px] text-slate-300">—</div>
              ) : (
                dayCells.map(({ loc, cell }) => (
                  <div
                    key={`${d}|${loc.id}`}
                    className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5"
                  >
                    <div className="truncate text-[11px] font-bold text-slate-700">
                      {loc.short_code ?? loc.name}
                    </div>
                    {cell!.entries.map((e) => {
                      return (
                        <div
                          key={`${d}|${loc.id}|${e.departmentId}`}
                          className="mt-1.5 rounded border bg-white px-1.5 py-1"
                          style={{ borderColor: `${e.departmentColor}55` }}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: e.departmentColor }}
                              aria-hidden
                            />
                            <span className="truncate text-[11px] font-semibold text-slate-700">
                              {e.departmentName}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {STAFF_CATEGORIES.map(({ key, label }) => {
                              const n = e.staffing[key];
                              return (
                                <span
                                  key={key}
                                  title={`${label}: ${n}`}
                                  className={`rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums ${
                                    n > 0
                                      ? "bg-slate-200 text-slate-700"
                                      : "bg-slate-100 text-slate-300"
                                  }`}
                                >
                                  {label} {n}
                                </span>
                              );
                            })}
                          </div>
                          {e.rule ? (
                            <div
                              className="mt-1 flex items-center justify-between gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800"
                              title={
                                e.rule.label
                                  ? `Capacity rule — ${e.rule.label}`
                                  : "Capacity rule"
                              }
                            >
                              <span className="truncate">Capacity</span>
                              <span className="shrink-0 tabular-nums">
                                {e.capacity} appt
                              </span>
                            </div>
                          ) : null}
                          {e.guide ? (
                            <Link
                              href={`/planning?guide=${e.guide.id}`}
                              className="mt-1 flex items-center justify-between gap-1 text-[11px] text-emerald-700 hover:underline"
                              title={
                                e.exact
                                  ? e.guide.name
                                  : `Closest match — ${e.guide.name}`
                              }
                            >
                              <span className="truncate">
                                {!e.exact && "≈ "}
                                {e.guide.name}
                              </span>
                              <span className="shrink-0 font-semibold">
                                {e.bookable} appt
                              </span>
                            </Link>
                          ) : null}
                          {canEdit ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                generate(
                                  d,
                                  loc.id,
                                  e.departmentId,
                                  e.capacity,
                                )
                              }
                              title={
                                e.guide
                                  ? `Regenerate an editable ${e.capacity}-appt guide for this day from the capacity number`
                                  : `Auto-generate an editable ${e.capacity}-appt guide for this day from the capacity number`
                              }
                              className="mt-1 w-full rounded border border-dashed border-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {pending
                                ? "Generating…"
                                : e.guide
                                  ? "↻ Regenerate guide"
                                  : "+ Generate guide"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
