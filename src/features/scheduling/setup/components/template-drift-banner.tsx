"use client";

import { RefreshCwIcon } from "lucide-react";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import { syncTemplateWeekFromShiftTemplates } from "@/features/scheduling/setup/actions/week-template-actions";
import type { TemplateDrift } from "@/features/scheduling/setup/lib/template-drift";

/**
 * Banner above the template grid: amber with the drift counts when the shift
 * lines no longer match the Dept/Shift Template, otherwise a quiet "in sync"
 * strip. Both carry the Rebuild button, which asks before dropping lines.
 */
export function TemplateDriftBanner({
  drift,
  templateTitle,
  templateId,
  canEdit,
}: {
  drift: TemplateDrift | null;
  templateTitle: string | null;
  templateId: string;
  canEdit: boolean;
}) {
  const outOfSync = !!drift && drift.total > 0;
  const rebuild = (
    <ActionButton
      action={() => syncTemplateWeekFromShiftTemplates(templateId)}
      success={(r) =>
        r.data
          ? `Rebuilt: ${r.data.added} added, ${r.data.updated} updated, ${r.data.removed} removed`
          : "Rebuilt from template"
      }
      confirm={{
        title: "Rebuild this template's shift lines from the Departments and Dept/Shift Template setups?",
        description:
          "Lines that are no longer in the Dept/Shift Template — including any added straight onto this grid — are removed along with their staffing.",
        confirmLabel: "Rebuild",
      }}
      disabled={!canEdit}
      variant={outOfSync ? "default" : "outline"}
      size="sm"
    >
      <RefreshCwIcon />
      Rebuild from template
    </ActionButton>
  );

  if (outOfSync) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-amber-800">
            “{templateTitle}” is out of sync with the Dept/Shift Template
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            {[
              drift.added && `${drift.added} line(s) missing`,
              drift.updated && `${drift.updated} changed`,
              drift.removed && `${drift.removed} no longer in the template`,
            ]
              .filter(Boolean)
              .join(" · ")}
            . Rebuild to make this grid match the Departments and
            Dept/Shift Template tabs.
          </p>
        </div>
        {rebuild}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-2.5 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">
        Shift lines match the Departments and Dept/Shift Template tabs.
      </p>
      {rebuild}
    </div>
  );
}
