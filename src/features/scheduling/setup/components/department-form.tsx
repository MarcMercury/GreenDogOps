"use client";

import type { SchedDepartment } from "@/lib/schedule/types";
import { btnGhost, btnPrimary, inputCls } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";

/** New / edit department form. Re-keyed on the department so edits start clean. */
export function DepartmentForm({
  editing,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  editing: SchedDepartment | null;
  pending: boolean;
  error: string | null;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        {editing ? "Edit department" : "New department"}
      </h2>
      <form
        action={onSubmit}
        className="space-y-3"
        key={editing?.id ?? "new"}
      >
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <label className="block text-xs font-medium text-slate-500">
          Name
          <input
            name="name"
            defaultValue={editing?.name ?? ""}
            required
            className={`mt-1 w-full ${inputCls}`}
            placeholder="VET-SURGERY"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Code
            <input
              name="code"
              defaultValue={editing?.code ?? ""}
              className={`mt-1 w-full ${inputCls}`}
              placeholder="SURG"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={editing?.sort_order ?? 0}
              className={`mt-1 w-20 ${inputCls}`}
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          Color
          <input
            name="color"
            type="color"
            defaultValue={editing?.color ?? "#64748b"}
            className="mt-1 block h-9 w-16 cursor-pointer rounded border border-slate-300"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={editing?.is_active ?? true}
          />
          Active
        </label>
        <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            name="show_in_planning"
            defaultChecked={editing?.show_in_planning ?? false}
            className="mt-0.5"
          />
          <span>
            Planning Guide
            <span className="block font-normal text-slate-400">
              Show this department in the Planning Guides dropdown and as a
              Daily Capacity area.
            </span>
          </span>
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {editing ? "Save" : "Add"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={onCancel}
              className={btnGhost}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
