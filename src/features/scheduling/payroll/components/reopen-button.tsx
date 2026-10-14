"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenPayPeriod } from "@/features/scheduling/payroll/actions/period-actions";
import { ActionNote } from "@/features/scheduling/payroll/components/action-note";
import type { ActionMessage } from "@/features/scheduling/payroll/types/action-message";

/** Reopen a locked period (Owner/Admin). Asks for the reason that goes into the audit log. */
export function ReopenButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionMessage>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Why are you reopening this pay period? (recorded in the audit log)");
          if (!reason?.trim()) return;
          start(async () => {
            const res = await reopenPayPeriod(period, reason);
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            router.refresh();
          });
        }}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        Reopen
      </button>
      <ActionNote msg={msg} />
    </span>
  );
}
