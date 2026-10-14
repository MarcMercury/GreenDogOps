"use client";

import {
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  formatWeekRange,
  type SchedWeek,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { LocationToggles } from "@/features/scheduling/scheduling-grid/components/location-toggles";
import { UnpublishedBanner } from "@/features/scheduling/scheduling-grid/components/unpublished-banner";
import { WeekPicker } from "@/features/scheduling/scheduling-grid/components/week-picker";
import { WorkflowButtons } from "@/features/scheduling/scheduling-grid/components/workflow-buttons";

/** Toolbar: week heading + workflow, publish banner, week picker, location toggles. */
export function GridToolbar({
  week,
  weeks,
  availableLocations,
  enabled,
  setEnabled,
  templateMode = false,
  templates = [],
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
  onStatus,
}: {
  week: SchedWeek;
  weeks: SchedWeek[];
  availableLocations: ScheduleLocation[];
  enabled: Set<string>;
  setEnabled: (s: Set<string>) => void;
  templateMode?: boolean;
  templates?: SchedWeek[];
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
  onStatus: (s: SchedWeek["status"]) => void;
}) {
  function toggle(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEnabled(next);
  }

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {templateMode ? "Week Template" : formatWeekRange(week.week_start)}
          </h1>
          {templateMode ? (
            <p className="mt-1 text-xs text-slate-500">
              Populate this reusable template with shifts and staffing, then apply
              it to any week from the Grid tab.
            </p>
          ) : (
            <span
              className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SCHEDULE_STATUS_TONE[week.status]}`}
            >
              {SCHEDULE_STATUS_LABELS[week.status]}
            </span>
          )}
        </div>
        {!templateMode && (
          <WorkflowButtons
            status={week.status}
            onStatus={onStatus}
            onPrintGrid={onPrintGrid}
            onPrintEmployee={onPrintEmployee}
            onExportCsv={onExportCsv}
          />
        )}
      </div>

      {!templateMode ? <UnpublishedBanner weekStart={week.week_start} status={week.status} /> : null}

      {!templateMode && (
        <WeekPicker weeks={weeks} selectedId={week.id} templates={templates} />
      )}

      <LocationToggles
        availableLocations={availableLocations}
        enabled={enabled}
        onToggle={toggle}
      />
    </div>
  );
}
