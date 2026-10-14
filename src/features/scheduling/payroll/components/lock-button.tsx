"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lockPayPeriod } from "@/features/scheduling/payroll/actions/period-actions";
import { ActionNote } from "@/features/scheduling/payroll/components/action-note";
import type { ActionMessage } from "@/features/scheduling/payroll/types/action-message";

/** Lock the open period. Disabled, with the reasons as its tooltip, while anything still blocks the lock. */
export function LockButton({ period, blockers }: { period: string; blockers: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionMessage>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy || blockers.length > 0}
        title={blockers.join(" ")}
        onClick={() => {
          if (!window.confirm("Lock this pay period? Approvals become final and no timecard changes can be added for these dates.")) return;
          start(async () => {
            const res = await lockPayPeriod(period);
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            router.refresh();
          });
        }}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
      >
        Lock period
      </button>
      <ActionNote msg={msg} />
    </span>
  );
}
