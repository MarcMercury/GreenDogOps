"use client";

import { timeRange } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RowsCardEntry } from "@/features/scheduling/scheduling-grid/components/sidebar/rows-card-entry";
import { PTO_COLOR } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import {
  PTO_ROW_ID,
  type RowVisibility,
  type RowsCardDepartment,
} from "@/features/scheduling/scheduling-grid/lib/row-visibility";

/**
 * The "Rows" card: which sections (and which shift lines inside them) the
 * grid shows. Hiding is a view filter only — nothing is deleted.
 */
export function RowsCard({
  departments,
  withPto,
  hidden,
  counts,
  roleName,
  onToggleDepartment,
  onToggleLine,
  onShowAll,
  onHideAll,
}: {
  departments: RowsCardDepartment[];
  withPto: boolean;
  hidden: RowVisibility;
  counts: { shown: number; total: number };
  roleName: (id: string | null) => string | null;
  onToggleDepartment: (id: string) => void;
  onToggleLine: (lineId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base font-bold">Rows</CardTitle>
        <CardDescription className="text-xs">
          {counts.shown} of {counts.total} shown
        </CardDescription>
        <CardAction className="flex items-center gap-0.5">
          <Button variant="ghost" size="xs" onClick={onShowAll}>
            Show all
          </Button>
          <Button variant="ghost" size="xs" onClick={onHideAll}>
            Hide all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {withPto && (
            <RowsCardEntry
              id={PTO_ROW_ID}
              name="PTO"
              color={PTO_COLOR}
              lines={[]}
              hidden={hidden.departments.has(PTO_ROW_ID)}
              hiddenLines={hidden.lines}
              onToggle={onToggleDepartment}
              onToggleLine={onToggleLine}
            />
          )}
          {departments.map(({ dept, lines }) => (
            <RowsCardEntry
              key={dept.id}
              id={dept.id}
              name={dept.name}
              color={dept.color}
              lines={lines.map(({ line }) => ({
                id: line.id,
                label: line.label || roleName(line.role_id) || "Shift",
                time: timeRange(line.start_time, line.end_time),
              }))}
              hidden={hidden.departments.has(dept.id)}
              hiddenLines={hidden.lines}
              onToggle={onToggleDepartment}
              onToggleLine={onToggleLine}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
