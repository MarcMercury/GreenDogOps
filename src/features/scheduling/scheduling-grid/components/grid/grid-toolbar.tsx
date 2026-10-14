"use client";

import {
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_TONE,
  formatWeekRange,
  type SchedWeek,
  type ScheduleLocation,
} from "@/lib/schedule/types";
import { Badge } from "@/components/ui/badge";
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
  onToggleLocation,
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
  onToggleLocation: (id: string) => void;
  templateMode?: boolean;
  templates?: SchedWeek[];
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
  onStatus: (s: SchedWeek["status"]) => void;
}) {
  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {templateMode ? "Week Template" : formatWeekRange(week.week_start)}
          </h1>
          {templateMode ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Populate this reusable template with shifts and staffing, then apply
              it to any week from the Grid tab.
            </p>
          ) : (
            <Badge variant="secondary" className={`mt-1 ${SCHEDULE_STATUS_TONE[week.status]}`}>
              {SCHEDULE_STATUS_LABELS[week.status]}
            </Badge>
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
        onToggle={onToggleLocation}
      />
    </div>
  );
}
