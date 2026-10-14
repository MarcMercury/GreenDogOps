"use client";

import { useRef, useState, useTransition } from "react";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { saveRole } from "@/features/scheduling/setup/actions/role-actions";
import { btnPrimary, inputCls } from "@/features/scheduling/setup/lib/ui-classes";

/** Inline "department + new role / title + order" form under the matrix header. */
export function AddRoleForm({
  data,
  onSaved,
}: {
  data: SetupData;
  onSaved: (departmentId: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const deptId = String(fd.get("department_id") ?? "");
    start(async () => {
      const res = await saveRole(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      onSaved(deptId);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
    >
      <label className="text-xs font-medium text-slate-500">
        Department
        <select
          name="department_id"
          required
          defaultValue=""
          className={`mt-1 block ${inputCls}`}
        >
          <option value="">Select…</option>
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-500">
        New role / title
        <input
          name="name"
          required
          placeholder="Surgery Tech"
          className={`mt-1 block ${inputCls}`}
        />
      </label>
      <label className="text-xs font-medium text-slate-500">
        Order
        <input
          name="sort_order"
          type="number"
          defaultValue={0}
          className={`mt-1 block w-20 ${inputCls}`}
        />
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        Add role
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
