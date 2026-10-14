"use client";

import { gridName, type SchedPerson } from "@/lib/schedule/types";
import { Checkbox } from "@/components/ui/checkbox";
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
        className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-border bg-card px-3 py-1.5 text-left text-sm font-normal group-hover:bg-muted"
      >
        {gridName(p)}
      </th>
      {columns.map((col) => {
        if (col.kind === "collapsed" || col.kind === "empty") {
          return (
            <td
              key={`${col.kind}-${col.deptId}`}
              className="border-b border-r border-border/60 bg-muted/60 group-hover:bg-muted"
            />
          );
        }
        const r = col.role;
        const checked = elig.has(eligibilityKey(r.id, p.id));
        return (
          <td
            key={r.id}
            className="border-b border-r border-border/60 px-2 py-1.5 text-center group-hover:bg-muted"
          >
            <div className="flex justify-center">
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(r.id, p.id)}
                aria-label={`${gridName(p)} eligible for ${r.name}`}
              />
            </div>
          </td>
        );
      })}
    </tr>
  );
}
