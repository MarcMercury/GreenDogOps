"use client";

import type { SchedDepartment } from "@/lib/schedule/types";
import { Card } from "@/features/scheduling/setup/components/card";

/** Every department with its colour swatch, flags and Edit / Delete links. */
export function DepartmentList({
  departments,
  onEdit,
  onDelete,
}: {
  departments: SchedDepartment[];
  onEdit: (dept: SchedDepartment) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        Departments ({departments.length})
      </h2>
      <ul className="divide-y divide-slate-100">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2">
            <span
              className="h-4 w-4 shrink-0 rounded"
              style={{ background: d.color }}
            />
            <span className="flex-1 text-sm font-medium text-slate-800">
              {d.name}
              {d.code ? (
                <span className="ml-2 text-xs text-slate-400">{d.code}</span>
              ) : null}
            </span>
            {!d.is_active && (
              <span className="text-xs text-slate-400">inactive</span>
            )}
            {d.show_in_planning && (
              <span
                className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                title="Appears in the Planning Guides department dropdown"
              >
                Planning
              </span>
            )}
            <button
              onClick={() => onEdit(d)}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(d.id)}
              className="text-xs font-medium text-red-500 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
        {departments.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-400">
            No departments yet. Add one to start.
          </li>
        )}
      </ul>
    </Card>
  );
}
