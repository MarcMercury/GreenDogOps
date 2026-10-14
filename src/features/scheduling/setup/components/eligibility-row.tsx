"use client";

import { gridName, type SchedPerson } from "@/lib/schedule/types";
import {
  eligibilityKey,
  type MatrixColumn,
} from "@/features/scheduling/setup/lib/eligibility";

/** One employee's row of eligibility checkboxes across the visible columns. */
export function EligibilityRow({
  person: p,
  columns,
  elig,
  onToggle,
}: {
  person: SchedPerson;
  columns: MatrixColumn[];
  /** Optimistic eligibility set, keyed by "roleId:personId". */
  elig: Set<string>;
  onToggle: (roleId: string, personId: string) => void;
}) {
  return (
    <tr className="group">
      <th
        scope="row"
        className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left text-sm font-normal text-slate-800 group-hover:bg-emerald-50"
      >
        {gridName(p)}
      </th>
      {columns.map((col) => {
        if (col.kind === "collapsed" || col.kind === "empty") {
          return (
            <td
              key={`${col.kind}-${col.deptId}`}
              className="border-b border-r border-slate-100 bg-slate-50/60 group-hover:bg-emerald-50"
            />
          );
        }
        const r = col.role;
        const checked = elig.has(eligibilityKey(r.id, p.id));
        return (
          <td
            key={r.id}
            className="border-b border-r border-slate-100 px-2 py-1.5 text-center group-hover:bg-emerald-50"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(r.id, p.id)}
              className="h-4 w-4 cursor-pointer accent-emerald-600"
              aria-label={`${gridName(p)} eligible for ${r.name}`}
            />
          </td>
        );
      })}
    </tr>
  );
}
