"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, PlusIcon } from "lucide-react";
import {
  formatWeekRange,
  weekStartFor,
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  type ScheduleStatus,
  type SchedWeek,
} from "@/lib/schedule/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/features/scheduling/shared/components/confirm-dialog";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import { toastError } from "@/features/scheduling/shared/lib/action-toast";
import {
  applyWeekTemplate,
  copyPreviousWeek,
  createWeek,
} from "@/features/scheduling/scheduling-grid/actions/week-actions";

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
  templates = [],
}: {
  weeks: SchedWeek[];
  selectedId: string | null;
  basePath?: string;
  /** Saved week templates, for the apply control. Only the grid passes these. */
  templates?: SchedWeek[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [newWeek, setNewWeek] = useState<string>(weekStartFor(new Date()));
  const [showAll, setShowAll] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [confirmTemplate, setConfirmTemplate] = useState<{ id: string; name: string } | null>(null);
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
    if (match) go(match.id);
    else toastError(`No week starting ${ws} yet — use “Create / open week” to add it.`);
  }

  /** Create (or just open) the week containing the picked date, then navigate to it. */
  function create() {
    const ws = weekStartFor(new Date(`${newWeek}T00:00:00`));
    void run(() => createWeek(ws), "Week opened", {
      onSuccess: (r) => {
        if (r.data) router.push(`/schedule?week=${r.data}`);
      },
    });
  }

  function copyPrevious() {
    const ws = weekStartFor(new Date(`${newWeek}T00:00:00`));
    void run(() => copyPreviousWeek(ws), "Previous week copied", {
      onSuccess: (r) => {
        if (r.data) router.push(`/schedule?week=${r.data}`);
      },
    });
  }

  function askToApplyTemplate() {
    if (!selectedId) {
      toastError("Open a week first, then apply a template to it.");
      return;
    }
    const chosen = templateId || templates[0]?.id;
    if (!chosen) {
      toastError("No templates saved yet — create one in Set Up › Week Template.");
      return;
    }
    const name = templates.find((t) => t.id === chosen)?.title ?? "template";
    setConfirmTemplate({ id: chosen, name });
  }

  return (
    <div className="space-y-2 print:hidden">
      {/* Stepper and rail stay on one line; the rail scrolls rather than wrapping,
          which would otherwise strand the next-week arrow on its own row. */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={() => prev && go(prev.id)}
                disabled={!prev}
                aria-label="Previous week"
              />
            }
          >
            <ChevronLeftIcon />
          </TooltipTrigger>
          <TooltipContent>
            {prev ? `Previous week — ${formatWeekRange(prev.week_start)}` : "No earlier week"}
          </TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {rail.map((w) => {
            const isSelected = w.id === selectedId;
            const isThisWeek = w.week_start === currentWeekStart;
            return (
              <Tooltip key={w.id}>
                <TooltipTrigger
                  render={
                    <Button
                      ref={isSelected ? selectedChip : undefined}
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() => go(w.id)}
                      aria-current={isSelected ? "page" : undefined}
                      className={`shrink-0 text-xs ${
                        !isSelected && isThisWeek
                          ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          : ""
                      }`}
                    />
                  }
                >
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[w.status]}`}
                  />
                  {chipLabel(w.week_start)}
                </TooltipTrigger>
                <TooltipContent>
                  {formatWeekRange(w.week_start)} · {SCHEDULE_STATUS_LABELS[w.status]}
                </TooltipContent>
              </Tooltip>
            );
          })}
          {rail.length === 0 && (
            <span className="px-2 text-xs text-muted-foreground">No weeks yet.</span>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={() => next && go(next.id)}
                disabled={!next}
                aria-label="Next week"
              />
            }
          >
            <ChevronRightIcon />
          </TooltipTrigger>
          <TooltipContent>
            {next ? `Next week — ${formatWeekRange(next.week_start)}` : "No later week"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {thisWeek && thisWeek.id !== selectedId && (
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            onClick={() => go(thisWeek.id)}
          >
            This week
          </Button>
        )}

        {selected && (
          <Badge variant="secondary" className={SCHEDULE_STATUS_TONE[selected.status]}>
            {SCHEDULE_STATUS_LABELS[selected.status]}
          </Badge>
        )}

        <Button size="sm" variant="outline" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? "Hide list" : `All weeks (${ordered.length})`}
        </Button>
      </div>

      {showAll && (
        <NativeSelect
          value={selectedId ?? ""}
          onChange={(e) => e.target.value && go(e.target.value)}
          aria-label="All weeks"
          className="w-full sm:w-auto"
        >
          <NativeSelectOption value="">Select a week…</NativeSelectOption>
          {[...ordered].reverse().map((w) => (
            <NativeSelectOption key={w.id} value={w.id}>
              {formatWeekRange(w.week_start)} · {SCHEDULE_STATUS_LABELS[w.status]}
              {w.week_start === currentWeekStart ? " · This week" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={newWeek}
          onChange={(e) => setNewWeek(e.target.value)}
          aria-label="Week date"
          className="w-auto"
        />
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" onClick={goToDate} />}>
            Go to week
          </TooltipTrigger>
          <TooltipContent>Open the week containing this date</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                  onClick={copyPrevious}
                  disabled={pending}
                />
              }
            >
              <CopyIcon /> Copy previous week
            </TooltipTrigger>
            <TooltipContent>
              Create the week and copy every shift, person, and time from the most recent prior week
            </TooltipContent>
          </Tooltip>
          {basePath === "/schedule" && templates.length > 0 && (
            <span className="flex items-center gap-1.5">
              {/* Only worth choosing between when there is more than one. */}
              {templates.length > 1 && (
                <NativeSelect
                  value={templateId || templates[0].id}
                  onChange={(e) => setTemplateId(e.target.value)}
                  aria-label="Template to apply"
                >
                  {templates.map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {t.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      className="border-sky-600 text-sky-700 hover:bg-sky-50"
                      onClick={askToApplyTemplate}
                      disabled={pending || !selectedId}
                    />
                  }
                >
                  {templates.length > 1 ? "Use template" : `Use “${templates[0].title}”`}
                </TooltipTrigger>
                <TooltipContent>
                  Replace the open week&apos;s shifts and staffing with the chosen template
                </TooltipContent>
              </Tooltip>
            </span>
          )}
          <Button onClick={create} disabled={pending} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <PlusIcon /> Create / open week
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmTemplate !== null}
        onOpenChange={(open) => !open && setConfirmTemplate(null)}
        title={`Replace this week with “${confirmTemplate?.name ?? "template"}”?`}
        description="This week's shifts and staffing will be overwritten with the template's."
        confirmLabel="Replace week"
        destructive
        onConfirm={async () => {
          if (selectedId && confirmTemplate) {
            await run(() => applyWeekTemplate(selectedId, confirmTemplate.id), "Template applied");
          }
        }}
      />
    </div>
  );
}
