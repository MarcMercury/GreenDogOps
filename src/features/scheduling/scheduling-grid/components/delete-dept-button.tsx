"use client";

import { useTransition } from "react";
import type { SchedDepartment } from "@/lib/schedule/types";
import { deleteDepartment } from "@/features/scheduling/setup/actions/department-actions";

/** The confirm-then-delete control inside the department modal. */
export function DeleteDeptButton({
  dept,
  onDone,
  setError,
}: {
  dept: SchedDepartment;
  onDone: () => void;
  setError: (s: string | null) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete department "${dept.name}"? Its roles and shift lines will be removed.`,
          )
        )
          return;
        setError(null);
        start(async () => {
          const res = await deleteDepartment(dept.id);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      Delete
    </button>
  );
}
