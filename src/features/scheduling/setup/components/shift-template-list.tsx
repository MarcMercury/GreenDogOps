"use client";

import { PencilIcon, XIcon } from "lucide-react";
import {
  timeRange,
  type SchedDepartment,
  type SchedShiftTemplate,
} from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import { deleteShiftTemplate } from "@/features/scheduling/setup/actions/shift-template-actions";

/** The canonical shift lines, grouped by active department. */
export function ShiftTemplateList({
  departments,
  templates,
  roleName,
  onEdit,
  onDeleted,
}: {
  departments: SchedDepartment[];
  templates: SchedShiftTemplate[];
  roleName: (id: string | null) => string;
  onEdit: (template: SchedShiftTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dept/Shift Template</CardTitle>
        <CardDescription>
          The canonical shift lines for every active department. The Week
          Template grid and every new week are built from exactly these lines.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lines.map((t) => {
                  const name = t.label || roleName(t.role_id);
                  return (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="flex-1 text-sm">
                        {name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {timeRange(t.start_time, t.end_time)}
                        </span>
                      </span>
                      <Button type="button" variant="ghost" size="xs" onClick={() => onEdit(t)}>
                        <PencilIcon />
                        Edit
                      </Button>
                      <ActionButton
                        action={() => deleteShiftTemplate(t.id)}
                        success="Template line deleted"
                        onSuccess={() => onDeleted(t.id)}
                        confirm={{
                          title: "Delete this template line?",
                          description: `${name} · ${timeRange(t.start_time, t.end_time) || "no times"}`,
                          confirmLabel: "Delete",
                          destructive: true,
                        }}
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <XIcon />
                      </ActionButton>
                    </li>
                  );
                })}
                {lines.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    No template lines.
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
