"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  formatWeekRange,
  weekStartFor,
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  type ScheduleStatus,
  type SchedWeek,
} from "@/lib/schedule/types";
import { copyPreviousWeek, createWeek, applyWeekTemplate } from "./actions";

/**
 * Week navigation.
 *
 * The schedule is past fifty weeks and gains one every week, so a single
 * dropdown of every week made the common case -- stepping to the week next
 * door -- cost an open, a scan and a click. The rail puts neighbouring weeks one
 * click away and shows their status as a colour, which is usually the real
 * question: how far ahead is the grid actually built?
 *
 * The full list is still available behind "All weeks" for jumping somewhere
 * distant.
 */

/** Weeks shown either side of the open one. */
const RAIL_RADIUS = 4;

const STATUS_DOT: Record<ScheduleStatus, string> = {
  draft: "bg-slate-300",
  pending_approval: "bg-amber-400",
  approved: "bg-sky-400",
  published: "bg-emerald-500",
  archived: "bg-slate-200",
};

/** "Sep 28" — short label for a rail chip. */
function chipLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function WeekPicker({
  weeks,
  selectedId,
  basePath = "/schedule",
}: {
  weeks: SchedWeek[];
  selectedId: string | null;
  basePath?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newWeek, setNewWeek] = useState<string>(weekStartFor(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const currentWeekStart = weekStartFor(new Date());

  // getWeeks() returns newest first; the rail reads left to right in time.
  const ordered = useMemo(
    () => [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start)),
    [weeks],
  );

  const selectedIndex = selectedId
    ? ordered.findIndex((w) => w.id === selectedId)
    : -1;
  const selected = selectedIndex >= 0 ? ordered[selectedIndex] : null;
  const thisWeek =
    ordered.find((w) => w.week_start === currentWeekStart) ?? null;

  // Anchor on the open week, or on today when nothing is open yet.
  const upcomingIndex = ordered.findIndex(
    (w) => w.week_start >= currentWeekStart,
  );
  const anchorIndex =
    selectedIndex >= 0
      ? selectedIndex
      : upcomingIndex >= 0
        ? upcomingIndex
        : Math.max(0, ordered.length - 1);

  const railStart = Math.max(0, anchorIndex - RAIL_RADIUS);
  const rail = ordered.slice(railStart, anchorIndex + RAIL_RADIUS + 1);

  const prev = selectedIndex > 0 ? ordered[selectedIndex - 1] : null;
  const next =
    selectedIndex >= 0 && selectedIndex < ordered.length - 1
      ? ordered[selectedIndex + 1]
      : null;

  // The rail is wider than the screen on smaller displays, so the open week can
  // land outside the visible area on load. Centre it instead.
  const selectedChip = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedChip.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId]);

  function go(id: string) {
    router.push(`${basePath}?week=${id}`);
  }

  /** Open the week containing the date in the picker, if one exists. */
  function goToDate() {
    const ws = weekStartFor(new Date(`${newWeek}T00:00:00`));
    const match = ordered.find((w) => w.week_start === ws);
    if (match) {
      setError(null);
      go(match.id);
    } else {
      setError(
        `No week starting ${ws} yet — use “Create / open week” to add it.`,
      );
    }
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

  function useTemplate() {
    if (!selectedId) {
      setError("Open a week first, then apply the template to it.");
      return;
    }
    if (
      !window.confirm(
        "Replace this week's shifts and staffing with the saved Week Template? Existing entries for this week will be overwritten.",
      )
    )
      return;
    setError(null);
    start(async () => {
      const res = await applyWeekTemplate(selectedId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const stepBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg leading-none text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-2 print:hidden">
      {/* Stepper and rail stay on one line; the rail scrolls rather than wrapping,
          which would otherwise strand the next-week arrow on its own row. */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => prev && go(prev.id)}
          disabled={!prev}
          title={
            prev
              ? `Previous week — ${formatWeekRange(prev.week_start)}`
              : "No earlier week"
          }
          aria-label="Previous week"
          className={stepBtn}
        >
          ‹
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {rail.map((w) => {
            const isSelected = w.id === selectedId;
            const isThisWeek = w.week_start === currentWeekStart;
            return (
              <button
                key={w.id}
                ref={isSelected ? selectedChip : undefined}
                onClick={() => go(w.id)}
                title={`${formatWeekRange(w.week_start)} · ${SCHEDULE_STATUS_LABELS[w.status]}`}
                aria-current={isSelected ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  isSelected
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isThisWeek
                      ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[w.status]}`}
                />
                {chipLabel(w.week_start)}
              </button>
            );
          })}
          {rail.length === 0 && (
            <span className="px-2 text-xs text-slate-400">No weeks yet.</span>
          )}
        </div>

        <button
          onClick={() => next && go(next.id)}
          disabled={!next}
          title={
            next
              ? `Next week — ${formatWeekRange(next.week_start)}`
              : "No later week"
          }
          aria-label="Next week"
          className={stepBtn}
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {thisWeek && thisWeek.id !== selectedId && (
          <button
            onClick={() => go(thisWeek.id)}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
          >
            This week
          </button>
        )}

        {selected && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SCHEDULE_STATUS_TONE[selected.status]}`}
          >
            {SCHEDULE_STATUS_LABELS[selected.status]}
          </span>
        )}

        <button
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {showAll ? "Hide list" : `All weeks (${ordered.length})`}
        </button>
      </div>

      {showAll && (
        <select
          value={selectedId ?? ""}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-emerald-500 focus:outline-none sm:w-auto"
        >
          <option value="">Select a week…</option>
          {[...ordered].reverse().map((w) => (
            <option key={w.id} value={w.id}>
              {formatWeekRange(w.week_start)} ·{" "}
              {SCHEDULE_STATUS_LABELS[w.status]}
              {w.week_start === currentWeekStart ? " · This week" : ""}
            </option>
          ))}
        </select>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={newWeek}
          onChange={(e) => setNewWeek(e.target.value)}
          aria-label="Week date"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          onClick={goToDate}
          title="Open the week containing this date"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Go to week
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={copyPrevious}
            disabled={pending}
            title="Create the week and copy every shift, person, and time from the most recent prior week"
            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
          >
            Copy previous week
          </button>
          {basePath === "/schedule" && (
            <button
              onClick={useTemplate}
              disabled={pending || !selectedId}
              title="Replace the open week's shifts and staffing with the saved Week Template"
              className="rounded-lg border border-sky-600 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-50"
            >
              Use template
            </button>
          )}
          <button
            onClick={create}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            + Create / open week
          </button>
        </div>
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
