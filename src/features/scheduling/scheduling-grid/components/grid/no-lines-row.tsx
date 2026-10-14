"use client";

import { ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";

/** The table body when the week has no shift lines at all. */
export function NoLinesRow({ span, onLoadTemplate }: { span: number; onLoadTemplate: () => void }) {
  const { canEdit } = useGrid();
  return (
    <tr>
      <td colSpan={span} className="px-4 py-10 text-center text-sm text-slate-400">
        No shift lines planned for this week yet.
        {canEdit && (
          <>
            <Button className="mx-auto mt-3 flex" onClick={onLoadTemplate}>
              <ZapIcon /> Load Dept/Shift Template
            </Button>
            <span className="mt-2 block text-xs text-slate-400">or add ad-hoc lines below.</span>
          </>
        )}
      </td>
    </tr>
  );
}
