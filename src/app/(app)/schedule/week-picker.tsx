"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  formatWeekRange,
  weekStartFor,
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  type SchedWeek,
} from "@/lib/schedule/types";
import { copyPreviousWeek, createWeek } from "./actions";

export function WeekPicker({
  weeks,
  selectedId,
}: {
  weeks: SchedWeek[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newWeek, setNewWeek] = useState<string>(weekStartFor(new Date()));
  const [error, setError] = useState<string | null>(null);

  function go(id: string) {
    router.push(`/schedule?week=${id}`);
  }

  function create() {
    const ws = weekStartFor(new Date(`${newWeek}T00:00:00`));
    setError(null);
    start(async () => {
      const res = await createWeek(ws);
      if (res.ok && res.data) {
        router.push(`/schedule?week=${res.data}`);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  function copyPrevious() {
    const ws = weekStartFor(new Date(`${newWeek}T00:00:00`));
    setError(null);
    start(async () => {
      const res = await copyPreviousWeek(ws);
      if (res.ok && res.data) {
        router.push(`/schedule?week=${res.data}`);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        value={selectedId ?? ""}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-emerald-500 focus:outline-none"
      >
        <option value="">Select a week…</option>
        {weeks.map((w) => (
          <option key={w.id} value={w.id}>
            {formatWeekRange(w.week_start)} ·{" "}
            {SCHEDULE_STATUS_LABELS[w.status]}
          </option>
        ))}
      </select>

      {selectedId && (
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            SCHEDULE_STATUS_TONE[
              weeks.find((w) => w.id === selectedId)?.status ?? "draft"
            ]
          }`}
        >
          {
            SCHEDULE_STATUS_LABELS[
              weeks.find((w) => w.id === selectedId)?.status ?? "draft"
            ]
          }
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <input
          type="date"
          value={newWeek}
          onChange={(e) => setNewWeek(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          onClick={copyPrevious}
          disabled={pending}
          title="Create the week and copy every shift, person, and time from the most recent prior week"
          className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
        >
          Copy previous week
        </button>
        <button
          onClick={create}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          + Create / open week
        </button>
      </div>
      {error && (
        <p className="w-full text-right text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
