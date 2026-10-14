"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveTimecard, unapproveTimecard } from "@/features/scheduling/payroll/actions/timecard-actions";
import { ActionNote } from "@/features/scheduling/payroll/components/action-note";
import type { ActionMessage } from "@/features/scheduling/payroll/types/action-message";

/** Approve one employee's timecard, or withdraw the approval, while the period is open. */
export function ApproveButton({
  period,
  personId,
  approved,
  disabled,
  title,
}: {
  period: string;
  personId: string;
  approved: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionMessage>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || disabled}
        title={title}
        onClick={() =>
          start(async () => {
            const res = approved ? await unapproveTimecard(period, personId) : await approveTimecard(period, personId);
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            router.refresh();
          })
        }
        className={
          approved
            ? "rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            : "rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        }
      >
        {busy ? "…" : approved ? "Un-approve" : "Approve"}
      </button>
      <ActionNote msg={msg} />
    </span>
  );
}
