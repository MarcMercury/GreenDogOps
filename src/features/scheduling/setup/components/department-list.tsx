"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import type { SchedDepartment } from "@/lib/schedule/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import { deleteDepartment } from "@/features/scheduling/setup/actions/department-actions";

/** Every department with its colour swatch, flags and Edit / Delete controls. */
export function DepartmentList({
  departments,
  onEdit,
  onDeleted,
}: {
  departments: SchedDepartment[];
  onEdit: (dept: SchedDepartment) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments ({departments.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <span
                className="h-4 w-4 shrink-0 rounded"
                style={{ background: d.color }}
              />
              <span className="flex-1 text-sm font-medium">
                {d.name}
                {d.code ? (
                  <span className="ml-2 text-xs text-muted-foreground">{d.code}</span>
                ) : null}
              </span>
              {!d.is_active && <Badge variant="outline">inactive</Badge>}
              {d.show_in_planning && (
                <Tooltip>
                  <TooltipTrigger render={<Badge variant="secondary" />}>Planning</TooltipTrigger>
                  <TooltipContent>Appears in the Planning Guides department dropdown</TooltipContent>
                </Tooltip>
              )}
              <Button type="button" variant="ghost" size="xs" onClick={() => onEdit(d)}>
                <PencilIcon />
                Edit
              </Button>
              <ActionButton
                action={() => deleteDepartment(d.id)}
                success="Department deleted"
                onSuccess={() => onDeleted(d.id)}
                confirm={{
                  title: `Delete department “${d.name}”?`,
                  description: "Its roles and shift lines will be removed.",
                  confirmLabel: "Delete",
                  destructive: true,
                }}
                variant="destructive"
                size="xs"
              >
                <Trash2Icon />
                Delete
              </ActionButton>
            </li>
          ))}
        </ul>
        {departments.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>No departments yet. Add one to start.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
