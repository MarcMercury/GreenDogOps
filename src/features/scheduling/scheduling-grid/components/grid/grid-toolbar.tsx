"use client";

import { useState } from "react";
import { CopyIcon } from "lucide-react";
import { formatWeekRange, type SchedWeek } from "@/lib/schedule/types";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import {
  applyWeekTemplate,
  copyPreviousWeek,
} from "@/features/scheduling/scheduling-grid/actions/week-actions";
import { WorkflowButtons } from "@/features/scheduling/scheduling-grid/components/workflow-buttons";

/**
 * The week's actions: rebuild it from the previous week or from a saved
 * template (both overwrite, both confirm), and the workflow buttons.
 */
export function GridToolbar({
  week,
  templates,
  canEdit,
  onStatus,
  onPrintGrid,
  onPrintEmployee,
  onExportCsv,
}: {
  week: SchedWeek;
  templates: SchedWeek[];
  canEdit: boolean;
  onStatus: (s: SchedWeek["status"]) => void;
  onPrintGrid: () => void;
  onPrintEmployee: () => void;
  onExportCsv: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const chosen = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  const chosenTitle = chosen?.title ?? "Untitled template";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <>
          <ActionButton
            variant="outline"
            action={() => copyPreviousWeek(week.week_start)}
            success="Previous week copied"
            confirm={{
              title: "Copy the previous week into this one?",
              description: `Every shift line, location, closure and assignment on ${formatWeekRange(week.week_start)} will be replaced with a copy of the most recent earlier week.`,
              confirmLabel: "Copy previous week",
              destructive: true,
            }}
          >
            <CopyIcon /> Copy previous week
          </ActionButton>
          {chosen && (
            <>
              {/* Only worth choosing between when there is more than one. */}
              {templates.length > 1 && (
                <NativeSelect
                  value={chosen.id}
                  onChange={(e) => setTemplateId(e.target.value)}
                  aria-label="Week template"
                  className="min-w-44"
                >
                  {templates.map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {t.title ?? "Untitled template"}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <ActionButton
                variant="outline"
                action={() => applyWeekTemplate(week.id, chosen.id)}
                success="Template applied"
                confirm={{
                  title: `Replace this week with “${chosenTitle}”?`,
                  description: "This week's shifts and staffing will be overwritten with the template's.",
                  confirmLabel: "Replace week",
                  destructive: true,
                }}
              >
                {templates.length > 1 ? "Use template" : `Use “${chosenTitle}”`}
              </ActionButton>
            </>
          )}
        </>
      )}
      <div className="ml-auto">
        <WorkflowButtons
          status={week.status}
          canEdit={canEdit}
          onStatus={onStatus}
          onPrintGrid={onPrintGrid}
          onPrintEmployee={onPrintEmployee}
          onExportCsv={onExportCsv}
        />
      </div>
    </div>
  );
}
