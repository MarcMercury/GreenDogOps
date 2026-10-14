"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveTimecard, lockPayPeriod, reopenPayPeriod, unapproveTimecard } from "./actions";

type Msg = { ok: boolean; text: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>;
}

export function ApproveButton({ period, personId, approved, disabled, title }: { period: string; personId: string; approved: boolean; disabled?: boolean; title?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
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
      <Note msg={msg} />
    </span>
  );
}

export function LockButton({ period, blockers }: { period: string; blockers: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
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
      <Note msg={msg} />
    </span>
  );
}

export function ReopenButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
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
      <Note msg={msg} />
    </span>
  );
}
