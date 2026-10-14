"use client";

import type { SchedWeek } from "@/lib/schedule/types";
import { btnGhost } from "@/features/scheduling/setup/lib/ui-classes";

/** The row of saved Week Templates plus the New / Rename / Duplicate / Delete controls. */
export function TemplatePicker({
  templates,
  selectedTemplateId,
  selected,
  pending,
  canEdit,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  templates: SchedWeek[];
  selectedTemplateId: string | null;
  /** The open template, when it is still in the list. */
  selected: SchedWeek | null;
  pending: boolean;
  canEdit: boolean;
  onOpen: (templateId: string) => void;
  onCreate: () => void;
  onRename: (template: SchedWeek) => void;
  onDuplicate: (template: SchedWeek) => void;
  onDelete: (template: SchedWeek) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Templates:
      </span>
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpen(t.id)}
          aria-current={t.id === selectedTemplateId ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            t.id === selectedTemplateId
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {t.title}
        </button>
      ))}
      <button
        onClick={onCreate}
        disabled={pending || !canEdit}
        className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-50"
      >
        + New template
      </button>

      {selected && canEdit && (
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={() => onRename(selected)} disabled={pending} className={btnGhost}>
            Rename
          </button>
          <button onClick={() => onDuplicate(selected)} disabled={pending} className={btnGhost}>
            Duplicate
          </button>
          <button
            onClick={() => onDelete(selected)}
            disabled={pending}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </span>
      )}
    </div>
  );
}
