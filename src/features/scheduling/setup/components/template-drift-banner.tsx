"use client";

import type { TemplateDrift } from "@/features/scheduling/setup/lib/template-drift";
import { btnGhost, btnPrimary } from "@/features/scheduling/setup/lib/ui-classes";

/**
 * Banner above the template grid: amber with the drift counts when the shift
 * lines no longer match the Dept/Shift Template, otherwise a quiet "in sync"
 * strip. Both carry the Rebuild button.
 */
export function TemplateDriftBanner({
  drift,
  templateTitle,
  pending,
  canEdit,
  onRebuild,
}: {
  drift: TemplateDrift | null;
  templateTitle: string | null;
  pending: boolean;
  canEdit: boolean;
  onRebuild: () => void;
}) {
  if (drift && drift.total > 0) {
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
        <button
          disabled={pending || !canEdit}
          onClick={onRebuild}
          className={btnPrimary}
        >
          {pending ? "Rebuilding…" : "Rebuild from template"}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
      <p className="text-xs text-slate-500">
        Shift lines match the Departments and Dept/Shift Template tabs.
      </p>
      <button
        disabled={pending || !canEdit}
        onClick={onRebuild}
        className={btnGhost}
      >
        {pending ? "Rebuilding…" : "Rebuild from template"}
      </button>
    </div>
  );
}
