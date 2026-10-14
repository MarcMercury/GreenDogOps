"use client";

import type { SchedDepartment, SchedRole, SchedShiftTemplate } from "@/lib/schedule/types";
import { btnGhost, btnPrimary, inputCls } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";

/** New / edit template-line form. Department and role are controlled by the tab. */
export function ShiftTemplateForm({
  editing,
  departments,
  formDept,
  roleSel,
  formRoles,
  pending,
  error,
  onDeptChange,
  onRoleChange,
  onSubmit,
  onCancel,
}: {
  editing: SchedShiftTemplate | null;
  departments: SchedDepartment[];
  formDept: string;
  /** "" = any · "__new__" = create role inline · otherwise an existing role id. */
  roleSel: string;
  formRoles: SchedRole[];
  pending: boolean;
  error: string | null;
  onDeptChange: (departmentId: string) => void;
  onRoleChange: (roleSel: string) => void;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        {editing ? "Edit template line" : "New template line"}
      </h2>
      <form action={onSubmit} className="space-y-3" key={editing?.id ?? "new"}>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <label className="block text-xs font-medium text-slate-500">
          Department
          <select
            name="department_id"
            value={formDept}
            onChange={(e) => onDeptChange(e.target.value)}
            required
            className={`mt-1 w-full ${inputCls}`}
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
            onChange={(e) => onRoleChange(e.target.value)}
            disabled={!formDept}
            className={`mt-1 w-full ${inputCls} disabled:bg-slate-50`}
          >
            <option value="">— any —</option>
            {formRoles.map((r) => (
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
              placeholder="e.g. Clinic Tech"
              className={`mt-1 w-full ${inputCls}`}
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Adds one eligibility checkbox for this role — reuse it for every
              shift time. Set who&apos;s eligible in Roles &amp; Eligibility.
            </span>
          </label>
        )}
        <label className="block text-xs font-medium text-slate-500">
          Label (optional)
          <input
            name="label"
            defaultValue={editing?.label ?? ""}
            className={`mt-1 w-full ${inputCls}`}
            placeholder="Defaults to role name"
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-xs font-medium text-slate-500">
            Start
            <input
              name="start_time"
              type="time"
              defaultValue={editing?.start_time ?? ""}
              className={`mt-1 w-full ${inputCls}`}
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            End
            <input
              name="end_time"
              type="time"
              defaultValue={editing?.end_time ?? ""}
              className={`mt-1 w-full ${inputCls}`}
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Order
            <input
              name="sort_order"
              type="number"
              defaultValue={editing?.sort_order ?? 0}
              className={`mt-1 w-16 ${inputCls}`}
            />
          </label>
        </div>
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
