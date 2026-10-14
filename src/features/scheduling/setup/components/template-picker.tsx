"use client";

import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { SchedWeek } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import { deleteTemplate } from "@/features/scheduling/setup/actions/week-template-actions";

/** The row of saved Week Templates plus the New / Rename / Duplicate / Delete controls. */
export function TemplatePicker({
  templates,
  selectedTemplateId,
  selected,
  canEdit,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
}: {
  templates: SchedWeek[];
  selectedTemplateId: string | null;
  /** The open template, when it is still in the list. */
  selected: SchedWeek | null;
  canEdit: boolean;
  onOpen: (templateId: string) => void;
  onCreate: () => void;
  onRename: (template: SchedWeek) => void;
  onDuplicate: (template: SchedWeek) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Templates:
      </span>
      {templates.map((t) => (
        <Button
          key={t.id}
          type="button"
          variant={t.id === selectedTemplateId ? "default" : "outline"}
          size="sm"
          onClick={() => onOpen(t.id)}
          aria-current={t.id === selectedTemplateId ? "page" : undefined}
        >
          {t.title}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-dashed"
        onClick={onCreate}
        disabled={!canEdit}
      >
        <PlusIcon />
        New template
      </Button>

      {selected && canEdit && (
        <span className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => onRename(selected)}>
            <PencilIcon />
            Rename
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(selected)}>
            <CopyIcon />
            Duplicate
          </Button>
          <ActionButton
            action={() => deleteTemplate(selected.id)}
            success="Template deleted"
            confirm={{
              title: `Delete the template “${selected.title}”?`,
              description:
                "Its shift lines and staffing go with it. Weeks already built from it are not affected.",
              confirmLabel: "Delete",
              destructive: true,
            }}
            variant="destructive"
            size="sm"
          >
            <Trash2Icon />
            Delete
          </ActionButton>
        </span>
      )}
    </div>
  );
}
