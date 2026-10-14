"use client";

import type { SchedRole } from "@/lib/schedule/types";
import type {
  DeptGroup,
  MatrixColumn,
} from "@/features/scheduling/setup/lib/eligibility";

/**
 * The two header rows of the eligibility matrix: department bands (click to
 * collapse / expand) over one column per role. Rendered inside `<thead>`.
 */
export function EligibilityMatrixHeader({
  deptGroups,
  columns,
  collapsed,
  pending,
  onToggleDept,
  onRemoveRole,
}: {
  deptGroups: DeptGroup[];
  columns: MatrixColumn[];
  collapsed: Set<string>;
  pending: boolean;
  onToggleDept: (deptId: string) => void;
  onRemoveRole: (role: SchedRole) => void;
}) {
  return (
    <>
      <tr>
        <th
          rowSpan={2}
          className="sticky left-0 top-0 z-40 min-w-[13rem] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-600"
        >
          Employee
        </th>
        {deptGroups.map((g) => {
          const isCollapsed = collapsed.has(g.dept.id);
          if (isCollapsed) {
            return (
              <th
                key={g.dept.id}
                rowSpan={2}
                onClick={() => onToggleDept(g.dept.id)}
                title={`Expand ${g.dept.name}`}
                className="sticky top-0 z-30 cursor-pointer select-none border-b border-r border-slate-200 px-1 py-2 text-center align-middle text-white"
                style={{ background: g.dept.color }}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[11px] leading-none">▸</span>
                  <span
                    className="text-[11px] font-semibold"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    {g.dept.code || g.dept.name}
                  </span>
                </div>
              </th>
            );
          }
          return (
            <th
              key={g.dept.id}
              colSpan={Math.max(g.roles.length, 1)}
              onClick={() => onToggleDept(g.dept.id)}
              title={`Collapse ${g.dept.name}`}
              className="sticky top-0 z-30 h-9 cursor-pointer select-none whitespace-nowrap border-b border-r border-slate-200 px-3 text-center text-xs font-semibold text-white"
              style={{ background: g.dept.color }}
            >
              <span className="inline-flex items-center gap-1">
                <span className="text-[10px] leading-none">▾</span>
                {g.dept.name}
              </span>
            </th>
          );
        })}
      </tr>
      <tr>
        {columns.map((col) => {
          if (col.kind === "collapsed") return null;
          if (col.kind === "empty") {
            return (
              <th
                key={`empty-${col.deptId}`}
                className="sticky top-9 z-30 min-w-[7rem] whitespace-nowrap border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center align-bottom text-[11px] font-normal italic text-slate-400"
              >
                No roles yet
              </th>
            );
          }
          return (
            <th
              key={col.role.id}
              className="group sticky top-9 z-30 min-w-[3.5rem] whitespace-nowrap border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center align-bottom text-[11px] font-medium text-slate-600"
            >
              <div className="flex items-center justify-center gap-1">
                <span>{col.role.name}</span>
                {!col.role.id.startsWith("__") && (
                  <button
                    type="button"
                    onClick={() => onRemoveRole(col.role)}
                    disabled={pending}
                    title="Delete role"
                    className="text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                )}
              </div>
            </th>
          );
        })}
      </tr>
    </>
  );
}
