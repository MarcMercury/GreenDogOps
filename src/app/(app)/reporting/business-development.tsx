"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  BizDevLocation,
  BizDevOpenDays,
  BizDevWeekdayFactors,
  BizDevProviderCapacity,
} from "@/lib/reporting/types";
import { LOCATION_COLORS } from "@/lib/reporting/types";
import {
  getBusinessDevelopmentData,
  updateBizDevApptType,
  saveBizDevOpenDays,
  saveBizDevProviderCapacity,
  addBizDevApptType,
  deleteBizDevApptType,
} from "./actions";
import { StatCard, SectionCard, fmtCurrency } from "./charts";

/** Average number of weeks in a month (52 / 12) for the monthly roll-up. */
const WEEKS_PER_MONTH = 52 / 12;

const DAY_DEFS: {
  key: keyof BizDevOpenDays;
  factorKey: keyof BizDevWeekdayFactors;
  label: string;
  title: string;
}[] = [
  { key: "open_sun", factorKey: "factor_sun", label: "S", title: "Sunday" },
  { key: "open_mon", factorKey: "factor_mon", label: "M", title: "Monday" },
  { key: "open_tue", factorKey: "factor_tue", label: "T", title: "Tuesday" },
  { key: "open_wed", factorKey: "factor_wed", label: "W", title: "Wednesday" },
  { key: "open_thu", factorKey: "factor_thu", label: "T", title: "Thursday" },
  { key: "open_fri", factorKey: "factor_fri", label: "F", title: "Friday" },
  { key: "open_sat", factorKey: "factor_sat", label: "S", title: "Saturday" },
];

function openDayCount(d: BizDevOpenDays): number {
  return DAY_DEFS.reduce((n, def) => n + (d[def.key] ? 1 : 0), 0);
}

/** Sum of the volume factors for the clinic's OPEN days (Σ factor over open days). */
function openDayFactorSum(loc: BizDevLocation): number {
  return DAY_DEFS.reduce(
    (s, def) =>
      s + (loc.open_days[def.key] ? Number(loc.weekday_factors[def.factorKey] ?? 1) : 0),
    0,
  );
}

interface LocTotals {
  /** Sum of realized avg appointments per day (current run-rate reference). */
  currentApptsPerDay: number;
  /** Planned appts/day across DAILY-cadence rows only. */
  plannedApptsPerDayDaily: number;
  /** Planned appts/week across WEEKLY-cadence rows only. */
  plannedWeeklyAppts: number;
  /** Expected planned appts on a typical (factor = 1) open day. */
  plannedApptsTypicalDay: number;
  /** Factor-weighted planned appts per week. */
  plannedApptsPerWeek: number;
  projWeekly: number;
  projDailyEffective: number;
  currentWeekly: number;
  projMonthly: number;
  currentMonthly: number;
  openDays: number;
  factorSum: number;
}

function computeTotals(loc: BizDevLocation): LocTotals {
  const openDays = openDayCount(loc.open_days);
  const factorSum = openDayFactorSum(loc);
  let currentApptsPerDay = 0;
  let plannedApptsPerDayDaily = 0;
  let plannedWeeklyAppts = 0;
  let projWeekly = 0;
  let currentWeekly = 0;
  for (const t of loc.types) {
    if (!t.included) continue;
    // Current run-rate: realized daily average, weighted by the weekday mix.
    currentApptsPerDay += t.avg_per_day;
    currentWeekly += t.avg_per_day * t.avg_value * factorSum;
    if (t.cadence === "weekly") {
      // A weekly service happens N times per week regardless of open-day count.
      plannedWeeklyAppts += t.planned_per_week;
      projWeekly += t.planned_per_week * t.avg_value;
    } else {
      plannedApptsPerDayDaily += t.planned_per_day;
      // Weight the week by the sum of open-day factors (Saturdays lighter, etc.).
      projWeekly += t.planned_per_day * t.avg_value * factorSum;
    }
  }
  const plannedApptsTypicalDay =
    plannedApptsPerDayDaily + (openDays > 0 ? plannedWeeklyAppts / openDays : 0);
  const plannedApptsPerWeek = plannedApptsPerDayDaily * factorSum + plannedWeeklyAppts;
  return {
    currentApptsPerDay,
    plannedApptsPerDayDaily,
    plannedWeeklyAppts,
    plannedApptsTypicalDay,
    plannedApptsPerWeek,
    projWeekly,
    projDailyEffective: openDays > 0 ? projWeekly / openDays : projWeekly,
    currentWeekly,
    projMonthly: projWeekly * WEEKS_PER_MONTH,
    currentMonthly: currentWeekly * WEEKS_PER_MONTH,
    openDays,
    factorSum,
  };
}

/**
 * A number input that keeps a local string while typing and commits the parsed
 * value on blur / Enter, so a save isn't fired on every keystroke.
 */
function NumberField({
  value,
  onCommit,
  disabled,
  prefix,
  step = 1,
  className = "",
}: {
  value: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
  prefix?: string;
  step?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  // Re-sync the editable draft when the committed value changes (e.g. after a
  // save rounds it) using the render-time prop-sync pattern, not an effect.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onCommit(Math.max(0, n));
    else setDraft(String(value));
  };
  return (
    <div className={`flex items-center justify-end gap-0.5 ${className}`}>
      {prefix ? <span className="text-xs text-slate-400">{prefix}</span> : null}
      <input
        type="number"
        min={0}
        step={step}
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200 disabled:bg-slate-50 disabled:text-slate-400"
      />
    </div>
  );
}

/** Day/Week segmented toggle: how a row's planned volume is modeled. */
function CadenceToggle({
  value,
  onChange,
  disabled,
}: {
  value: "daily" | "weekly";
  onChange: (c: "daily" | "weekly") => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-[11px] font-semibold">
      {(["daily", "weekly"] as const).map((c) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!on) onChange(c);
            }}
            title={c === "daily" ? "Modeled per open day" : "Modeled per week"}
            className={`px-2 py-1 transition ${
              on ? "bg-slate-800 text-white" : "bg-white text-slate-400 hover:bg-slate-50"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {c === "daily" ? "Day" : "Wk"}
          </button>
        );
      })}
    </div>
  );
}

/** Small realized hourly-demand bar chart (booked appts on a typical open day). */
function HourDemandChart({
  data,
  color,
}: {
  data: { hour: number; avg_per_open_day: number }[];
  color: string;
}) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No hourly demand yet — accrues as the Agenda is pulled each morning.
      </p>
    );
  }
  const byHour = new Map(data.map((d) => [d.hour, d.avg_per_open_day]));
  const hours = data.map((d) => d.hour);
  const lo = Math.min(7, ...hours);
  const hi = Math.max(20, ...hours);
  const max = Math.max(...data.map((d) => d.avg_per_open_day), 0.1);
  const fmtHour = (h: number) =>
    h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
  const cols: number[] = [];
  for (let h = lo; h <= hi; h++) cols.push(h);
  return (
    <div className="flex items-end gap-1" style={{ height: 96 }}>
      {cols.map((h) => {
        const v = byHour.get(h) ?? 0;
        const pct = Math.round((v / max) * 100);
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] tabular-nums text-slate-400">
              {v > 0 ? v.toFixed(1) : ""}
            </span>
            <div className="flex w-full items-end" style={{ height: 60 }}>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${pct}%`,
                  minHeight: v > 0 ? 2 : 0,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
                title={`${fmtHour(h)}: ${v.toFixed(2)} appts/day`}
              />
            </div>
            <span className="text-[9px] tabular-nums text-slate-400">
              {fmtHour(h)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only weekday ranking, busiest (1) to slowest (7), from the volume mix. */
function WeekdayRanking({
  loc,
  color,
}: {
  loc: BizDevLocation;
  color: string;
}) {
  const ranked = DAY_DEFS.map((d) => ({
    title: d.title,
    factor: Number(loc.weekday_factors[d.factorKey] ?? 1),
  })).sort((a, b) => b.factor - a.factor);
  return (
    <div className="flex flex-wrap gap-2">
      {ranked.map((d, i) => (
        <div
          key={d.title}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {i + 1}
          </span>
          <span className="text-xs font-medium text-slate-700">{d.title}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact provider-role picker for a service line. */
function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: "dvm" | "tech" | "none";
  onChange: (v: "dvm" | "tech" | "none") => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as "dvm" | "tech" | "none")}
      className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200 disabled:bg-slate-50 disabled:text-slate-400"
    >
      <option value="dvm">Doctor</option>
      <option value="tech">Tech</option>
      <option value="none">None</option>
    </select>
  );
}

interface RoleCapacity {
  demandDays: number;
  count: number;
  added: number;
  capacity: number;
  util: number;
  avgRevPerDay: number;
  addedWeekly: number;
  unsetCount: number;
}

/** Aggregate a clinic's capacity demand for one provider role. */
function roleCapacity(
  loc: BizDevLocation,
  totals: LocTotals,
  role: "dvm" | "tech",
): RoleCapacity {
  let demandDays = 0;
  let revPerDay = 0;
  let unsetCount = 0;
  for (const t of loc.types) {
    if (!t.included || t.provider_role !== role) continue;
    const eff =
      t.cadence === "weekly"
        ? totals.openDays > 0
          ? t.planned_per_week / totals.openDays
          : 0
        : t.planned_per_day;
    if (eff <= 0) continue;
    if (t.per_provider_day > 0) {
      demandDays += eff / t.per_provider_day;
      revPerDay += eff * t.avg_value;
    } else {
      unsetCount += 1;
    }
  }
  const count = role === "dvm" ? loc.provider.dvm_count : loc.provider.tech_count;
  const added = role === "dvm" ? loc.provider.added_dvms : loc.provider.added_techs;
  const capacity = count + added;
  const avgRevPerDay = demandDays > 0 ? revPerDay / demandDays : 0;
  const unmet = Math.max(demandDays - count, 0);
  const addedFill = Math.min(added, unmet);
  const addedWeekly = addedFill * avgRevPerDay * totals.factorSum;
  const util = capacity > 0 ? demandDays / capacity : demandDays > 0 ? Infinity : 0;
  return { demandDays, count, added, capacity, util, avgRevPerDay, addedWeekly, unsetCount };
}

/** Provider-backed capacity: doctors AND techs, driven by per-service throughput. */
function ProviderCapacityPanel({
  loc,
  totals,
  canEdit,
  onChange,
}: {
  loc: BizDevLocation;
  totals: LocTotals;
  canEdit: boolean;
  onChange: (provider: BizDevProviderCapacity) => void;
}) {
  const rows: {
    key: "dvm" | "tech";
    label: string;
    cap: RoleCapacity;
    countField: keyof BizDevProviderCapacity;
    addField: keyof BizDevProviderCapacity;
  }[] = [
    {
      key: "dvm",
      label: "Doctors",
      cap: roleCapacity(loc, totals, "dvm"),
      countField: "dvm_count",
      addField: "added_dvms",
    },
    {
      key: "tech",
      label: "Techs",
      cap: roleCapacity(loc, totals, "tech"),
      countField: "tech_count",
      addField: "added_techs",
    },
  ];
  const addedMonthly =
    (rows[0].cap.addedWeekly + rows[1].cap.addedWeekly) * WEEKS_PER_MONTH;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
      {rows.map((r) => {
        const over = r.cap.util > 1;
        return (
          <div key={r.key} className="flex flex-wrap items-end gap-3">
            <div className="w-16 pb-1 text-sm font-semibold text-slate-700">
              {r.label}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Staffed/day
              </p>
              <NumberField
                value={r.cap.count}
                disabled={!canEdit}
                step={0.5}
                onCommit={(n) => onChange({ ...loc.provider, [r.countField]: n })}
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                + Add
              </p>
              <NumberField
                value={r.cap.added}
                disabled={!canEdit}
                step={0.5}
                onCommit={(n) => onChange({ ...loc.provider, [r.addField]: n })}
              />
            </div>
            <div className="ml-auto pb-1 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Demand vs capacity
              </p>
              <p
                className={`text-sm font-bold tabular-nums ${over ? "text-rose-600" : "text-slate-800"}`}
              >
                {r.cap.demandDays.toFixed(1)} / {r.cap.capacity.toFixed(1)} prov-days
                {Number.isFinite(r.cap.util)
                  ? ` · ${Math.round(r.cap.util * 100)}%`
                  : r.cap.demandDays > 0
                    ? " · no staff"
                    : ""}
              </p>
              {r.cap.unsetCount > 0 ? (
                <p className="text-[10px] text-amber-600">
                  {r.cap.unsetCount} service{r.cap.unsetCount === 1 ? "" : "s"} with
                  no /prov·day rate — not counted
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {rows.some((r) => r.cap.util > 1) ? (
        <p className="text-xs font-medium text-rose-600">
          Plan exceeds provider capacity — add providers or reduce planned volume.
        </p>
      ) : null}
      {addedMonthly > 0 ? (
        <p className="text-xs font-medium text-emerald-700">
          Added-provider upside: {fmtCurrency(addedMonthly)}/mo (fills unmet demand
          at the average value of those services).
        </p>
      ) : null}
    </div>
  );
}

/** One clinic's planning card. */
function LocationPlanner({
  loc,
  canEdit,
  onPatchType,
  onToggleDay,
  onAddType,
  onRemoveType,
  onSaveProvider,
}: {
  loc: BizDevLocation;
  canEdit: boolean;
  onPatchType: (
    typeId: string,
    patch: {
      avg_value?: number;
      avg_per_day?: number;
      planned_per_day?: number;
      planned_per_week?: number;
      cadence?: "daily" | "weekly";
      max_per_day?: number;
      provider_role?: "dvm" | "tech" | "none";
      per_provider_day?: number;
      included?: boolean;
    },
  ) => void;
  onToggleDay: (key: keyof BizDevOpenDays) => void;
  onAddType: (name: string, value: number) => void;
  onRemoveType: (typeId: string) => void;
  onSaveProvider: (provider: BizDevProviderCapacity) => void;
}) {
  const totals = useMemo(() => computeTotals(loc), [loc]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const color = LOCATION_COLORS[loc.location_key] ?? "#10b981";
  const upliftMonthly = totals.projMonthly - totals.currentMonthly;

  // Included rows first (in their base order); unchecked rows drop to the bottom.
  const orderedTypes = useMemo(
    () =>
      [...loc.types].sort(
        (a, b) =>
          (a.included === b.included ? 0 : a.included ? -1 : 1) ||
          a.sort_order - b.sort_order ||
          a.appt_type.localeCompare(b.appt_type),
      ),
    [loc.types],
  );

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="group flex items-start gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <span className="mt-0.5 text-slate-400 transition group-hover:text-slate-600">
            {collapsed ? "▸" : "▾"}
          </span>
          <span>
            <span className="text-sm font-semibold text-slate-900">
              {loc.location_label}
            </span>
            {collapsed ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                {fmtCurrency(totals.projMonthly)}/mo · {totals.openDays} days/wk
              </span>
            ) : (
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Base numbers from real data — appointment values recovered by
                matching the Agenda to invoices; avg/day from recent Agenda
                bookings. Clinic blended average{" "}
                {fmtCurrency(loc.blended_avg_value)} (fallback for types with no
                matched revenue).
              </span>
            )}
          </span>
        </button>
        {!collapsed ? (
          <div className="flex items-center gap-1.5">
            {DAY_DEFS.map((d) => {
              const on = loc.open_days[d.key];
              return (
                <button
                  key={d.key}
                  type="button"
                  title={d.title}
                  disabled={!canEdit}
                  onClick={() => onToggleDay(d.key)}
                  className={`h-7 w-7 rounded-full text-xs font-semibold transition ${
                    on
                      ? "text-white"
                      : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                  } disabled:cursor-not-allowed`}
                  style={on ? { backgroundColor: color } : undefined}
                >
                  {d.label}
                </button>
              );
            })}
            <span className="ml-1 text-xs text-slate-500">
              {totals.openDays} days/wk
            </span>
          </div>
        ) : null}
      </div>

      {!collapsed ? (
        <>
      <div className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Weekday ranking (busiest → slowest)
        </p>
        <WeekdayRanking loc={loc} color={color} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="w-8 py-2 pr-2 text-center">On</th>
              <th className="py-2 pr-3">Appointment type</th>
              <th className="py-2 pr-3 text-center">Cadence</th>
              <th className="py-2 pr-3 text-right">Avg/day</th>
              <th className="py-2 pr-3 text-right">Planned/day</th>
              <th className="py-2 pr-3 text-right">Planned/wk</th>
              <th className="py-2 pr-3 text-right">Max/day</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2 pr-3 text-right">/Prov·day</th>
              <th className="py-2 pr-3 text-right">Avg value</th>
              <th className="py-2 pr-3 text-right">Proj. $/wk</th>
              {canEdit ? <th className="w-8 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orderedTypes.map((t) => {
              const isWeekly = t.cadence === "weekly";
              const projWeekly = isWeekly
                ? t.planned_per_week * t.avg_value
                : t.planned_per_day * t.avg_value * totals.factorSum;
              // Effective appts on a typical day vs the capacity ceiling.
              const effPerDay = isWeekly
                ? totals.openDays > 0
                  ? t.planned_per_week / totals.openDays
                  : t.planned_per_week
                : t.planned_per_day;
              const overCap = t.max_per_day > 0 && effPerDay > t.max_per_day + 0.001;
              return (
                <tr
                  key={t.id}
                  className={t.included ? "" : "opacity-45"}
                >
                  <td className="py-1.5 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={t.included}
                      disabled={!canEdit}
                      onChange={(e) =>
                        onPatchType(t.id, { included: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-slate-700">
                      {t.appt_type}
                    </span>
                    {t.is_custom ? (
                      <span className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-medium uppercase text-indigo-500">
                        custom
                      </span>
                    ) : null}
                    {t.matched_paid > 0 ? (
                      <span
                        className="ml-1.5 text-[10px] text-slate-400"
                        title={`Average value from ${t.matched_paid} matched paid appointment${t.matched_paid === 1 ? "" : "s"} (Agenda ↔ invoice)`}
                      >
                        n={t.matched_paid}
                      </span>
                    ) : null}
                    {overCap ? (
                      <span
                        className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-rose-600"
                        title={`Planned ${effPerDay.toFixed(1)}/day exceeds the ${t.max_per_day}/day capacity ceiling`}
                      >
                         over cap
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-center">
                    <CadenceToggle
                      value={t.cadence}
                      disabled={!canEdit}
                      onChange={(c) => {
                        // Switching to weekly with no weekly count yet? Seed it
                        // from the daily plan × open days so the projection holds.
                        if (
                          c === "weekly" &&
                          t.planned_per_week === 0 &&
                          t.planned_per_day > 0
                        ) {
                          onPatchType(t.id, {
                            cadence: c,
                            planned_per_week: Math.round(
                              t.planned_per_day * totals.openDays,
                            ),
                          });
                        } else {
                          onPatchType(t.id, { cadence: c });
                        }
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.avg_per_day}
                      disabled={!canEdit}
                      step={0.5}
                      onCommit={(n) => onPatchType(t.id, { avg_per_day: n })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.planned_per_day}
                      disabled={!canEdit || isWeekly}
                      onCommit={(n) =>
                        onPatchType(t.id, { planned_per_day: n })
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.planned_per_week}
                      disabled={!canEdit || !isWeekly}
                      onCommit={(n) =>
                        onPatchType(t.id, { planned_per_week: n })
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.max_per_day}
                      disabled={!canEdit}
                      step={0.5}
                      className={overCap ? "text-rose-600" : ""}
                      onCommit={(n) => onPatchType(t.id, { max_per_day: n })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <RoleSelect
                      value={t.provider_role}
                      disabled={!canEdit}
                      onChange={(v) => onPatchType(t.id, { provider_role: v })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.per_provider_day}
                      disabled={!canEdit || t.provider_role === "none"}
                      step={0.5}
                      onCommit={(n) =>
                        onPatchType(t.id, { per_provider_day: n })
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.avg_value}
                      disabled={!canEdit}
                      prefix="$"
                      step={10}
                      onCommit={(n) => onPatchType(t.id, { avg_value: n })}
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-slate-800">
                    {fmtCurrency(projWeekly)}
                  </td>
                  {canEdit ? (
                    <td className="py-1.5 text-center">
                      {t.is_custom ? (
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => onRemoveType(t.id)}
                          className="text-slate-300 hover:text-rose-500"
                        >
                          ×
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 text-sm font-semibold text-slate-800">
              <td />
              <td className="py-2 pr-3">Totals</td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                {totals.currentApptsPerDay.toFixed(1)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {totals.plannedApptsPerDayDaily.toFixed(1)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {totals.plannedApptsPerWeek.toFixed(1)}
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">
                {fmtCurrency(totals.projWeekly)}
              </td>
              {canEdit ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add appointment type…"
            className="min-w-[200px] flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Avg $"
            inputMode="decimal"
            className="w-24 rounded-md border border-slate-200 px-2.5 py-1.5 text-right text-sm tabular-nums focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
          />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={() => {
              const v = Number(newValue);
              onAddType(newName.trim(), Number.isFinite(v) ? v : 0);
              setNewName("");
              setNewValue("");
            }}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Add type
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          label="Proj. $/day"
          value={fmtCurrency(totals.projDailyEffective)}
        />
        <MiniStat
          label="Proj. $/week"
          value={fmtCurrency(totals.projWeekly)}
        />
        <MiniStat
          label="Proj. $/month"
          value={fmtCurrency(totals.projMonthly)}
          accent
        />
        <MiniStat
          label="Monthly vs current"
          value={`${upliftMonthly >= 0 ? "+" : ""}${fmtCurrency(upliftMonthly)}`}
          tone={upliftMonthly >= 0 ? "up" : "down"}
        />
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Provider capacity
        </p>
        <ProviderCapacityPanel
          loc={loc}
          totals={totals}
          canEdit={canEdit}
          onChange={onSaveProvider}
        />
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Hourly demand — booked appts on a typical open day
        </p>
        <HourDemandChart data={loc.hour_demand} color={color} />
      </div>
        </>
      ) : null}
    </section>
  );
}

function MiniStat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "up" | "down";
}) {
  const color = tone === "up"
    ? "text-emerald-600"
    : tone === "down"
      ? "text-rose-600"
      : accent
        ? "text-emerald-700"
        : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export function BusinessDevelopment({ canEdit }: { canEdit: boolean }) {
  const [locations, setLocations] = useState<BizDevLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getBusinessDevelopmentData()
      .then((d) => {
        if (active) setLocations(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load.");
      });
    return () => {
      active = false;
    };
  }, []);

  const patchType = (
    locId: string,
    typeId: string,
    patch: {
      avg_value?: number;
      avg_per_day?: number;
      planned_per_day?: number;
      planned_per_week?: number;
      cadence?: "daily" | "weekly";
      max_per_day?: number;
      provider_role?: "dvm" | "tech" | "none";
      per_provider_day?: number;
      included?: boolean;
    },
  ) => {
    setLocations((prev) =>
      prev
        ? prev.map((l) =>
            l.location_id === locId
              ? {
                  ...l,
                  types: l.types.map((t) =>
                    t.id === typeId ? { ...t, ...patch } : t,
                  ),
                }
              : l,
          )
        : prev,
    );
    startTransition(async () => {
      const res = await updateBizDevApptType(typeId, patch);
      if (!res.ok) setError(res.error);
    });
  };

  const toggleDay = (locId: string, key: keyof BizDevOpenDays) => {
    let next: BizDevOpenDays | null = null;
    setLocations((prev) =>
      prev
        ? prev.map((l) => {
            if (l.location_id !== locId) return l;
            const open_days = { ...l.open_days, [key]: !l.open_days[key] };
            next = open_days;
            return { ...l, open_days };
          })
        : prev,
    );
    if (next) {
      const days = next;
      startTransition(async () => {
        const res = await saveBizDevOpenDays(locId, days);
        if (!res.ok) setError(res.error);
      });
    }
  };

  const saveProvider = (locId: string, provider: BizDevProviderCapacity) => {
    setLocations((prev) =>
      prev
        ? prev.map((l) =>
            l.location_id === locId ? { ...l, provider } : l,
          )
        : prev,
    );
    startTransition(async () => {
      const res = await saveBizDevProviderCapacity(locId, provider);
      if (!res.ok) setError(res.error);
    });
  };

  const addType = (locId: string, name: string, value: number) => {
    startTransition(async () => {
      const res = await addBizDevApptType(locId, name, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLocations((prev) =>
        prev
          ? prev.map((l) =>
              l.location_id === locId
                ? { ...l, types: [...l.types, res.row] }
                : l,
            )
          : prev,
      );
    });
  };

  const removeType = (locId: string, typeId: string) => {
    setLocations((prev) =>
      prev
        ? prev.map((l) =>
            l.location_id === locId
              ? { ...l, types: l.types.filter((t) => t.id !== typeId) }
              : l,
          )
        : prev,
    );
    startTransition(async () => {
      const res = await deleteBizDevApptType(typeId);
      if (!res.ok) setError(res.error);
    });
  };

  if (error && !locations) {
    return (
      <SectionCard title="Business Development">
        <p className="text-sm text-rose-600">{error}</p>
      </SectionCard>
    );
  }

  if (!locations) {
    return (
      <SectionCard title="Business Development">
        <p className="text-sm text-slate-400">Loading planner…</p>
      </SectionCard>
    );
  }

  const grand = locations.reduce(
    (acc, l) => {
      const t = computeTotals(l);
      acc.projMonthly += t.projMonthly;
      acc.currentMonthly += t.currentMonthly;
      return acc;
    },
    { projMonthly: 0, currentMonthly: 0 },
  );
  const uplift = grand.projMonthly - grand.currentMonthly;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Projected monthly revenue"
          value={fmtCurrency(grand.projMonthly)}
          sub="All clinics · planned scenario"
          accent="emerald"
        />
        <StatCard
          label="Current run-rate monthly"
          value={fmtCurrency(grand.currentMonthly)}
          sub="Current avg bookings × your values"
          accent="slate"
        />
        <StatCard
          label="Monthly upside"
          value={`${uplift >= 0 ? "+" : ""}${fmtCurrency(uplift)}`}
          sub="Planned vs current run-rate"
          accent={uplift >= 0 ? "emerald" : "amber"}
        />
        <StatCard
          label="Annualized upside"
          value={`${uplift >= 0 ? "+" : ""}${fmtCurrency(uplift * 12)}`}
          sub="Monthly upside × 12 (reference)"
          accent="indigo"
        />
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Model potential revenue by clinic: pick the days open, then set how many
        of each appointment type you&apos;d render. Use the{" "}
        <strong>Day/Wk</strong> toggle to model a service that doesn&apos;t
        happen every day on a <strong>weekly</strong> basis instead (e.g. a
        weekly surgery block) — weekly rows project{" "}
        <em>planned/week × value</em> directly. Every appointment type is listed
        at every clinic, so you can <strong>toggle on</strong> a service a clinic
        doesn&apos;t offer yet to model adding it. The{" "}
        <strong>weekday volume mix</strong> weights each open day (Saturdays run
        lighter — seeded from real revenue), <strong>Max/day</strong> flags a
        plan that exceeds a service&apos;s realistic capacity, and each service
        has a <strong>Role</strong> (Doctor / Tech / None) and a{" "}
        <strong>/prov·day</strong> throughput so the{" "}
        <strong>provider capacity</strong> panel checks doctors and techs
        separately — Advanced Procedures tie up a doctor far longer than exams,
        and Tech Services need no doctor at all. The{" "}
        <strong>hourly demand</strong> chart shows when appointments actually
        book. The <strong>avg value</strong> and <strong>avg/day</strong> are
        real base numbers recovered from the Agenda and invoices. All are
        editable, so tune them and the projection recalculates.
        {canEdit ? " Changes save automatically." : " Read-only — ask an admin to edit."}
      </p>

      {locations.map((loc) => (
        <LocationPlanner
          key={loc.location_id}
          loc={loc}
          canEdit={canEdit}
          onPatchType={(typeId, patch) =>
            patchType(loc.location_id, typeId, patch)
          }
          onToggleDay={(key) => toggleDay(loc.location_id, key)}
          onAddType={(name, value) => addType(loc.location_id, name, value)}
          onRemoveType={(typeId) => removeType(loc.location_id, typeId)}
          onSaveProvider={(provider) => saveProvider(loc.location_id, provider)}
        />
      ))}
    </div>
  );
}
