"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SchedWeek } from "@/lib/schedule/types";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";
import { ScheduleGrid } from "@/features/scheduling/scheduling-grid/components/grid/schedule-grid";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  renameTemplate,
  syncTemplateWeekFromShiftTemplates,
} from "@/features/scheduling/setup/actions/week-template-actions";
import { templateDrift } from "@/features/scheduling/setup/lib/template-drift";
import { TemplatePicker } from "@/features/scheduling/setup/components/template-picker";
import { TemplateDriftBanner } from "@/features/scheduling/setup/components/template-drift-banner";
import { WeekTemplateIntroCard } from "@/features/scheduling/setup/components/week-template-intro-card";

// ===========================================================================
// Week Template — a full, populated schedule grid the admin keeps as a template
// ===========================================================================

export function WeekTemplateTab({
  data,
  templates,
  templateWeek,
  selectedTemplateId,
  weeks,
  canEdit,
}: {
  data: SetupData;
  templates: SchedWeek[];
  templateWeek: WeekData | null;
  selectedTemplateId: string | null;
  weeks: SchedWeek[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const drift = useMemo(
    () => (templateWeek ? templateDrift(data, templateWeek.lines) : null),
    [data, templateWeek],
  );

  /** Run an action, surfacing its error rather than failing silently. */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "Something went wrong.");
    });
  }

  function create() {
    const name = window.prompt("Name this template", "Standard Week");
    if (name === null) return;
    setError(null);
    start(async () => {
      const res = await createTemplate(name);
      if (res.ok && res.data) {
        router.push(`/schedule/setup?template=${res.data}`);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  function rename(t: SchedWeek) {
    const name = window.prompt("Rename template", t.title ?? "");
    if (name === null) return;
    run(() => renameTemplate(t.id, name));
  }

  function duplicate(t: SchedWeek) {
    const name = window.prompt(
      "Name for the copy",
      `${t.title ?? "Template"} (copy)`,
    );
    if (name === null) return;
    setError(null);
    start(async () => {
      const res = await duplicateTemplate(t.id, name);
      if (res.ok && res.data) {
        router.push(`/schedule/setup?template=${res.data}`);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  function remove(t: SchedWeek) {
    if (
      !window.confirm(
        `Delete the template “${t.title}”?\n\nIts shift lines and staffing go with it. Weeks already built from it are not affected.`,
      )
    )
      return;
    run(() => deleteTemplate(t.id));
  }

  function sync() {
    if (!selectedTemplateId) return;
    if (
      !window.confirm(
        "Rebuild this template's shift lines from the Departments and Dept/Shift Template setups?\n\nLines that are no longer in the Dept/Shift Template — including any added straight onto this grid — are removed along with their staffing.",
      )
    )
      return;
    run(() => syncTemplateWeekFromShiftTemplates(selectedTemplateId));
  }

  const selected = templates.find((t) => t.id === selectedTemplateId) ?? null;

  return (
    <div className="space-y-4">
      <TemplatePicker
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        selected={selected}
        pending={pending}
        canEdit={canEdit}
        onOpen={(id) => router.push(`/schedule/setup?template=${id}`)}
        onCreate={create}
        onRename={rename}
        onDuplicate={duplicate}
        onDelete={remove}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {templateWeek && selected ? (
        <>
          <TemplateDriftBanner
            drift={drift}
            templateTitle={selected.title}
            pending={pending}
            canEdit={canEdit}
            onRebuild={sync}
          />
          <ScheduleGrid
            weeks={weeks}
            weekData={templateWeek}
            setup={data}
            timeOff={[]}
            canEdit={canEdit}
            templateMode
          />
        </>
      ) : (
        <WeekTemplateIntroCard pending={pending} canEdit={canEdit} onCreate={create} />
      )}
    </div>
  );
}
