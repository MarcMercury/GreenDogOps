"use client";

import { useMemo, useState } from "react";

export interface ActivityItem {
  id: string;
  /** Local time-of-day label, e.g. "2:04 PM". */
  time: string;
  actor: string;
  moduleLabel: string;
  moduleIcon: string;
  moduleHref: string;
  summary: string;
}

export interface ActivityDay {
  /** Sortable key, e.g. "2026-07-08". */
  key: string;
  /** Human label, e.g. "Today · Jul 8" or "Mon, Jul 7". */
  label: string;
  items: ActivityItem[];
}

function DayFeed({ day }: { day: ActivityDay }) {
  if (day.items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-slate-400">
        No activity recorded for this day.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-50">
      {day.items.map((it) => (
        <li key={it.id} className="flex items-start gap-3 px-4 py-2.5">
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-sm ring-1 ring-inset ring-slate-200/70"
            title={it.moduleLabel}
          >
            {it.moduleIcon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-slate-700">{it.summary}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              <span className="font-medium text-slate-500">
                {it.moduleLabel}
              </span>
              {" · "}
              {it.actor}
            </p>
          </div>
          <time className="mt-0.5 shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-400">
            {it.time}
          </time>
        </li>
      ))}
    </ul>
  );
}

/**
 * Program-wide activity feed. The current day is always open and visible;
 * earlier days are reachable through the dropdown selector.
 */
export function ActivityLog({ days }: { days: ActivityDay[] }) {
  const today = days[0];
  const pastDays = useMemo(() => days.slice(1), [days]);
  const [selectedKey, setSelectedKey] = useState<string>("");

  const selectedDay = useMemo(
    () => pastDays.find((d) => d.key === selectedKey) ?? null,
    [pastDays, selectedKey],
  );

  if (!today) {
    return (
      <p className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
        No activity to show yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current day — always open */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {today.label}
          </h3>
          <span className="text-xs text-slate-400">
            {today.items.length} update{today.items.length === 1 ? "" : "s"}
          </span>
        </div>
        <DayFeed day={today} />
      </div>

      {/* Past days — via dropdown */}
      {pastDays.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-800">
              Earlier activity
            </h3>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>Select a day</span>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="">Choose a date…</option>
                {pastDays.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({d.items.length})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedDay ? (
            <DayFeed day={selectedDay} />
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Pick a date above to view that day&apos;s activity.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
