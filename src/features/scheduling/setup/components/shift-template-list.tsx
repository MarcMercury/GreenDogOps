"use client";

import {
  timeRange,
  type SchedDepartment,
  type SchedShiftTemplate,
} from "@/lib/schedule/types";
import { Card } from "@/features/scheduling/setup/components/card";

/** The canonical shift lines, grouped by active department. */
export function ShiftTemplateList({
  departments,
  templates,
  roleName,
  onEdit,
  onDelete,
}: {
  departments: SchedDepartment[];
  templates: SchedShiftTemplate[];
  roleName: (id: string | null) => string;
  onEdit: (template: SchedShiftTemplate) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-700">
        Dept/Shift Template
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-slate-400">
        The canonical shift lines for every active department. The Week
        Template grid and every new week are built from exactly these lines.
      </p>
      <div className="space-y-4">
        {departments.map((dept) => {
          const lines = templates.filter(
            (t) => t.is_active && t.department_id === dept.id,
          );
          return (
            <div key={dept.id}>
              <p
                className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
                style={{ color: dept.color }}
              >
                {dept.name}
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {lines.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 text-sm text-slate-800">
                      {t.label || roleName(t.role_id)}
                      <span className="ml-2 font-mono text-xs text-slate-400">
                        {timeRange(t.start_time, t.end_time)}
                      </span>
                    </span>
                    <button
                      onClick={() => onEdit(t)}
                      className="text-xs font-medium text-slate-500 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {lines.length === 0 && (
                  <li className="px-3 py-2 text-xs text-slate-400">
                    No template lines.
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
