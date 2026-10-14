"use client";

import { useState, useTransition } from "react";
import type { SchedDepartment } from "@/lib/schedule/types";
import { saveDepartment } from "@/features/scheduling/setup/actions/department-actions";
import { DeleteDeptButton } from "@/features/scheduling/scheduling-grid/components/delete-dept-button";

/** Add or edit a department directly from the grid. */
export function DeptModal({
  dept,
  onClose,
  onDone,
}: {
  dept: SchedDepartment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    if (dept) fd.set("id", dept.id);
    start(async () => {
      const res = await saveDepartment(fd);
      if (!res.ok) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        action={submit}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            {dept ? "Edit department" : "Add department"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <label className="block text-xs font-medium text-slate-500">
          Name
          <input
            name="name"
            defaultValue={dept?.name ?? ""}
            required
            placeholder="e.g. Surgery"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Color
            <input
              name="color"
              type="color"
              defaultValue={dept?.color ?? "#64748b"}
              className="mt-1 block h-9 w-16 cursor-pointer rounded border border-slate-300"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={dept?.sort_order ?? 9999}
              className="mt-1 w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>
        <input type="hidden" name="is_active" value="on" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {dept ? (
            <DeleteDeptButton dept={dept} onDone={onDone} setError={setError} />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {dept ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
