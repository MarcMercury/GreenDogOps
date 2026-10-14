"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SchedWeek } from "@/lib/schedule/types";
import type { WeekData } from "@/features/scheduling/scheduling-grid/types/week-data";
import { ScheduleGrid } from "@/features/scheduling/scheduling-grid/components/grid/schedule-grid";
import { PromptDialog, type PromptValues } from "@/features/scheduling/shared/components/prompt-dialog";
import { formValidator } from "@/features/scheduling/shared/lib/form-validator";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import type { TemplatePrompt } from "@/features/scheduling/setup/types/template-prompt";
import {
  createTemplate,
  duplicateTemplate,
  renameTemplate,
} from "@/features/scheduling/setup/actions/week-template-actions";
import { templateDrift } from "@/features/scheduling/setup/lib/template-drift";
import { templatePromptConfig } from "@/features/scheduling/setup/lib/template-prompt";
import { templateNamePromptSchema } from "@/features/scheduling/setup/schema/week-template.schema";
import { TemplatePicker } from "@/features/scheduling/setup/components/template-picker";
import { TemplateDriftBanner } from "@/features/scheduling/setup/components/template-drift-banner";
import { WeekTemplateIntroCard } from "@/features/scheduling/setup/components/week-template-intro-card";

// ===========================================================================
// Week Template — a full, populated schedule grid the admin keeps as a template
// ===========================================================================

const templateNameValidator = formValidator<PromptValues>(templateNamePromptSchema);

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
  // Which name the dialog is asking for; null while it is closed.
  const [prompt, setPrompt] = useState<TemplatePrompt | null>(null);

  const drift = useMemo(
    () => (templateWeek ? templateDrift(data, templateWeek.lines) : null),
    [data, templateWeek],
  );

  const selected = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const promptConfig = templatePromptConfig(prompt ?? { kind: "create" });

  /** Run the action behind the name dialog; a new or copied template is opened. */
  async function submitName(name: string) {
    if (!prompt) return { ok: false as const, error: "Nothing to name." };
    if (prompt.kind === "rename") {
      const res = await renameTemplate(prompt.template.id, name);
      if (res.ok) router.refresh();
      return res;
    }
    const res =
      prompt.kind === "create"
        ? await createTemplate(name)
        : await duplicateTemplate(prompt.template.id, name);
    if (res.ok && res.data) {
      router.push(`/schedule/setup?template=${res.data}`);
      router.refresh();
    }
    return res;
  }

  return (
    <div className="space-y-4">
      <TemplatePicker
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        selected={selected}
        canEdit={canEdit}
        onOpen={(id) => router.push(`/schedule/setup?template=${id}`)}
        onCreate={() => setPrompt({ kind: "create" })}
        onRename={(template) => setPrompt({ kind: "rename", template })}
        onDuplicate={(template) => setPrompt({ kind: "duplicate", template })}
      />

      {templateWeek && selected ? (
        <>
          <TemplateDriftBanner
            drift={drift}
            templateTitle={selected.title}
            templateId={selected.id}
            canEdit={canEdit}
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
        <WeekTemplateIntroCard canEdit={canEdit} onCreate={() => setPrompt({ kind: "create" })} />
      )}

      <PromptDialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
        title={promptConfig.title}
        label="Template name"
        placeholder="Standard Week"
        defaultValue={promptConfig.defaultValue}
        submitLabel={promptConfig.submitLabel}
        validator={templateNameValidator}
        onSubmit={submitName}
        success={promptConfig.success}
      />
    </div>
  );
}
