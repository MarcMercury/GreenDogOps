"use client";

import { useMemo, useState } from "react";
import type { BizDevLocation } from "@/lib/reporting/types";
import { LOCATION_COLORS } from "@/lib/reporting/types";
import { DAY_DEFS, buildDayPlan } from "@/lib/reporting/bizdev";
import type { BizDevDayPlan } from "@/lib/reporting/bizdev";
import { apptChipStyle, bucketMarker, minutesToLabel } from "@/lib/planning/types";
import { fmtCurrency } from "../reporting/charts";

const STEP_OPTIONS = [15, 30, 60] as const;

/** The planning-guide rendering of one clinic's planned day. */
function DayGuide({ plan }: { plan: BizDevDayPlan }) {
  const accent = LOCATION_COLORS[plan.locationKey] ?? "#10b981";
  const slotsByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of plan.slots) {
      const key = `${s.columnId}:${s.startMinute}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [plan.slots]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {plan.locationLabel}
            <span className="ml-2 font-normal text-slate-500">
              {plan.weekdayLabel}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Open {minutesToLabel(plan.startMinute)} to{" "}
            {minutesToLabel(plan.endMinute)} · {plan.stepMinutes}-minute slots ·{" "}
            {plan.columns.length} track
            {plan.columns.length === 1 ? "" : "s"}
            {plan.hasHourDemand
              ? " · weighted by realized hourly demand"
              : " · evenly spread (no hourly demand yet)"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Metric label="Appointments" value={String(plan.totalAppts)} />
          <Metric label="Projected" value={fmtCurrency(plan.totalRevenue)} accent />
          <Metric label="Day factor" value={`${plan.factor.toFixed(2)}×`} />
        </div>
      </div>

      {!plan.isOpen ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          {plan.locationLabel} is set to closed on {plan.weekdayLabel}. Turn the day
          on in the Business Development tab to plan it.
        </p>
      ) : plan.columns.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          No planned appointments for this day. Set a Planned/day or Planned/week
          on the Business Development tab.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto p-2">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-14 bg-slate-50 px-2 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Time
                  </th>
                  {plan.columns.map((col) => (
                    <th
                      key={col.id}
                      className="border-b-2 border-slate-200 bg-slate-50 px-2 py-2 text-left align-top"
                      style={{ minWidth: 130, borderTop: `3px solid ${col.color}` }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        <span className="truncate font-semibold text-slate-700">
                          {col.name}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">
                        {col.count} × {fmtCurrency(col.avgValue)} ={" "}
                        {fmtCurrency(col.revenue)}
                        {col.cadence === "weekly" ? " · weekly" : ""}
                      </p>
                      {col.overCap ? (
                        <span className="mt-0.5 inline-block rounded bg-rose-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-rose-600">
                          over cap
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.buckets.map((bucket) => {
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
                      {plan.columns.map((col) => {
                        const n = slotsByCell.get(`${col.id}:${bucket}`) ?? 0;
                        return (
                          <td
                            key={col.id}
                            className={`border-l border-slate-100 px-1.5 py-1 ${rowBorder}`}
                          >
                            <div className="flex min-h-[1.5rem] flex-wrap gap-1">
                              {Array.from({ length: n }, (_, i) => (
                                <span
                                  key={i}
                                  style={apptChipStyle(col.color)}
                                  className="rounded border px-1.5 py-0.5 text-xs font-medium leading-tight"
                                  title={`${col.name} — ${minutesToLabel(bucket)}`}
                                >
                                  {col.short}
                                </span>
                              ))}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Legend
            </span>
            {plan.columns.map((col) => (
              <span
                key={col.id}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: col.color }}
                />
                {col.short} — {col.name}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={`text-base font-bold tabular-nums ${
          accent ? "text-emerald-700" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The Business Development plan rendered as a planning guide: one column per
 * appointment type, one row per time bucket, per clinic.
 */
export function PlanningGuideView({
  locations,
  generatedAt,
}: {
  locations: BizDevLocation[];
  /** Set when the user has run "Convert to planning guide". */
  generatedAt: number | null;
}) {
  const [weekday, setWeekday] = useState<number>(() => new Date().getDay());
  const [step, setStep] = useState<number>(30);
  const [locationId, setLocationId] = useState<string>("all");

  const plans = useMemo(
    () =>
      locations
        .filter((l) => locationId === "all" || l.location_id === locationId)
        .map((l) => buildDayPlan(l, weekday, step)),
    [locations, locationId, weekday, step],
  );

  if (!generatedAt) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
        <p className="text-sm font-medium text-slate-700">
          No planning guide generated yet.
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Go to the <strong>Business Development</strong> tab and press{" "}
          <strong>Convert to planning guide</strong> to lay the planned
          appointments out across the day, per clinic.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Day
          </span>
          {DAY_DEFS.map((d) => {
            const on = d.weekday === weekday;
            return (
              <button
                key={d.weekday}
                type="button"
                title={d.title}
                onClick={() => setWeekday(d.weekday)}
                className={`h-7 w-7 rounded-full text-xs font-semibold transition ${
                  on
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Slot
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-[11px] font-semibold">
            {STEP_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                className={`px-2 py-1 transition ${
                  s === step
                    ? "bg-slate-800 text-white"
                    : "bg-white text-slate-400 hover:bg-slate-50"
                }`}
              >
                {s}m
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-500">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Clinic
          </span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
          >
            <option value="all">All clinics</option>
            {locations.map((l) => (
              <option key={l.location_id} value={l.location_id}>
                {l.location_label}
              </option>
            ))}
          </select>
        </label>

        <p className="ml-auto text-xs text-slate-400">
          Each clinic&apos;s day spans its hours from the Business Development
          tab. Daily services scale by the weekday factor; weekly services are
          spread across the open days.
        </p>
      </div>

      {plans.map((plan) => (
        <DayGuide key={plan.locationId} plan={plan} />
      ))}
    </div>
  );
}
