"use client";

import { useState, useTransition } from "react";
import type { SchedDepartment, SchedRole, SchedWeekLine } from "@/lib/schedule/types";
import {
  addWeekLine,
  updateWeekLine,
} from "@/features/scheduling/scheduling-grid/actions/week-line-actions";

/** Add or edit a shift line on the week's grid. */
export function LineModal({
  weekId,
  departments,
  roles,
  line,
  defaultDeptId,
  onClose,
  onDone,
}: {
  weekId: string;
  departments: SchedDepartment[];
  roles: SchedRole[];
  line: SchedWeekLine | null;
  defaultDeptId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deptId, setDeptId] = useState(
    line?.department_id ?? defaultDeptId ?? "",
  );
  // "" = any · "__new__" = create role inline · otherwise an existing role id.
  const [roleSel, setRoleSel] = useState<string>(line?.role_id ?? "");
  const deptRoles = roles.filter((r) => r.department_id === deptId);

  function submit(fd: FormData) {
    setError(null);
    fd.set("week_id", weekId);
    fd.set("department_id", deptId);
    if (line) fd.set("id", line.id);
    if (roleSel === "__new__") {
      fd.set("role_id", "");
    } else {
      fd.set("role_id", roleSel);
      fd.delete("new_role_name");
    }
    start(async () => {
      const res = line ? await updateWeekLine(fd) : await addWeekLine(fd);
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
            {line ? "Edit shift line" : "Add shift line"}
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
          Department
          <select
            value={deptId}
            onChange={(e) => {
              setDeptId(e.target.value);
              setRoleSel("");
            }}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Role (eligibility)
          <select
            value={roleSel}
            onChange={(e) => setRoleSel(e.target.value)}
            disabled={!deptId}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
          >
            <option value="">— any —</option>
            {deptRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__new__">+ New role…</option>
          </select>
        </label>
        {roleSel === "__new__" && (
          <label className="block text-xs font-medium text-slate-500">
            New role name
            <input
              name="new_role_name"
              required
              placeholder="e.g. Surgery Tech"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Set who is eligible for it in Set Up → Roles &amp; Eligibility.
            </span>
          </label>
        )}
        <label className="block text-xs font-medium text-slate-500">
          Label (optional)
          <input
            name="label"
            defaultValue={line?.label ?? ""}
            placeholder="e.g. Float / Coverage"
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Start
            <input
              name="start_time"
              type="time"
              defaultValue={line?.start_time ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            End
            <input
              name="end_time"
              type="time"
              defaultValue={line?.end_time ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={line?.sort_order ?? 9999}
              className="mt-1 w-16 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {line ? "Save" : "Add line"}
          </button>
        </div>
      </form>
    </div>
  );
}
