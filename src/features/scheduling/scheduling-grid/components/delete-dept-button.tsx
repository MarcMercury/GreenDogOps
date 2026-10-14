"use client";

import type { SchedDepartment } from "@/lib/schedule/types";
import { ActionButton } from "@/features/scheduling/shared/components/action-button";
import { deleteDepartment } from "@/features/scheduling/setup/actions/department-actions";

/** The confirm-then-delete control inside the department modal. */
export function DeleteDeptButton({
  dept,
  onDone,
}: {
  dept: SchedDepartment;
  /** Closes the modal and refreshes the grid. */
  onDone: () => void;
}) {
  return (
    <ActionButton
      variant="destructive"
      action={() => deleteDepartment(dept.id)}
      success="Department deleted"
      confirm={{
        title: `Delete department “${dept.name}”?`,
        description: "Its roles and shift lines will be removed.",
        confirmLabel: "Delete",
        destructive: true,
      }}
      refresh={false}
      onSuccess={onDone}
    >
      Delete
    </ActionButton>
  );
}
