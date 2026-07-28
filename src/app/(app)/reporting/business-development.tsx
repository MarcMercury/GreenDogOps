"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  BizDevLocation,
  BizDevOpenDays,
} from "@/lib/reporting/types";
import { LOCATION_COLORS } from "@/lib/reporting/types";
import {
  getBusinessDevelopmentData,
  updateBizDevApptType,
  saveBizDevOpenDays,
  addBizDevApptType,
  deleteBizDevApptType,
} from "./actions";
import { StatCard, SectionCard, fmtCurrency } from "./charts";

/** Average number of weeks in a month (52 / 12) for the monthly roll-up. */
const WEEKS_PER_MONTH = 52 / 12;

const DAY_DEFS: { key: keyof BizDevOpenDays; label: string; title: string }[] = [
  { key: "open_sun", label: "S", title: "Sunday" },
  { key: "open_mon", label: "M", title: "Monday" },
  { key: "open_tue", label: "T", title: "Tuesday" },
  { key: "open_wed", label: "W", title: "Wednesday" },
  { key: "open_thu", label: "T", title: "Thursday" },
  { key: "open_fri", label: "F", title: "Friday" },
  { key: "open_sat", label: "S", title: "Saturday" },
];

function openDayCount(d: BizDevOpenDays): number {
  return DAY_DEFS.reduce((n, def) => n + (d[def.key] ? 1 : 0), 0);
}

/** Monthly projection = daily × open days/week × ~4.33 weeks/month. */
function monthlyFrom(daily: number, openDays: number): number {
  return daily * openDays * WEEKS_PER_MONTH;
}

interface LocTotals {
  plannedApptsPerDay: number;
  currentApptsPerDay: number;
  projDaily: number;
  currentDaily: number;
  projMonthly: number;
  currentMonthly: number;
  openDays: number;
}

function computeTotals(loc: BizDevLocation): LocTotals {
  const openDays = openDayCount(loc.open_days);
  let plannedApptsPerDay = 0;
  let currentApptsPerDay = 0;
  let projDaily = 0;
  let currentDaily = 0;
  for (const t of loc.types) {
    if (!t.included) continue;
    plannedApptsPerDay += t.planned_per_day;
    currentApptsPerDay += t.current_avg_per_day;
    projDaily += t.planned_per_day * t.avg_value;
    currentDaily += t.current_avg_per_day * t.avg_value;
  }
  return {
    plannedApptsPerDay,
    currentApptsPerDay,
    projDaily,
    currentDaily,
    projMonthly: monthlyFrom(projDaily, openDays),
    currentMonthly: monthlyFrom(currentDaily, openDays),
    openDays,
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

/** One clinic's planning card. */
function LocationPlanner({
  loc,
  canEdit,
  onPatchType,
  onToggleDay,
  onAddType,
  onRemoveType,
}: {
  loc: BizDevLocation;
  canEdit: boolean;
  onPatchType: (
    typeId: string,
    patch: { avg_value?: number; planned_per_day?: number; included?: boolean },
  ) => void;
  onToggleDay: (key: keyof BizDevOpenDays) => void;
  onAddType: (name: string, value: number) => void;
  onRemoveType: (typeId: string) => void;
}) {
  const totals = useMemo(() => computeTotals(loc), [loc]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const color = LOCATION_COLORS[loc.location_key] ?? "#10b981";
  const upliftMonthly = totals.projMonthly - totals.currentMonthly;

  return (
    <SectionCard
      title={loc.location_label}
      description={`Clinic average appointment value ${fmtCurrency(
        loc.blended_avg_value,
      )} · seeds new type values. Averages from recent Agenda bookings.`}
      action={
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
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="w-8 py-2 pr-2 text-center">On</th>
              <th className="py-2 pr-3">Appointment type</th>
              <th className="py-2 pr-3 text-right">Current avg/day</th>
              <th className="py-2 pr-3 text-right">Planned/day</th>
              <th className="py-2 pr-3 text-right">Avg value</th>
              <th className="py-2 pr-3 text-right">Proj. $/day</th>
              {canEdit ? <th className="w-8 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loc.types.map((t) => {
              const projDaily = t.planned_per_day * t.avg_value;
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
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                    {t.days_observed > 0 ? (
                      <span title={`${t.days_observed} days observed`}>
                        {t.current_avg_per_day.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <NumberField
                      value={t.planned_per_day}
                      disabled={!canEdit}
                      onCommit={(n) =>
                        onPatchType(t.id, { planned_per_day: n })
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
                    {fmtCurrency(projDaily)}
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
              <td className="py-2 pr-3">Totals (per open day)</td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                {totals.currentApptsPerDay.toFixed(1)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {totals.plannedApptsPerDay.toFixed(1)}
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">
                {fmtCurrency(totals.projDaily)}
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
        <MiniStat label="Proj. $/day" value={fmtCurrency(totals.projDaily)} />
        <MiniStat
          label="Proj. $/week"
          value={fmtCurrency(totals.projDaily * totals.openDays)}
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
    </SectionCard>
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
    patch: { avg_value?: number; planned_per_day?: number; included?: boolean },
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
        of each appointment type you&apos;d render per open day and its average
        value. Values seed from each clinic&apos;s blended average appointment
        value — tune them to match what each type is really worth. &quot;Current
        avg/day&quot; is what you currently average from recent Agenda bookings.
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
        />
      ))}
    </div>
  );
}
