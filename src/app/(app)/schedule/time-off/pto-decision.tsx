"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewPtoRequest } from "./actions";

const input = "rounded-lg border border-slate-300 px-2 py-1 text-sm";

export function PtoDecision({
  id,
  kind,
  defaultDays,
  maxDays,
  available,
  disabled,
  disabledReason,
}: {
  id: string;
  kind: string;
  defaultDays: number;
  maxDays: number;
  available: number | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [paid, setPaid] = useState(kind === "time_off" ? "time_off" : kind);
  const [days, setDays] = useState(String(defaultDays));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isPaid = paid !== "time_off";
  const after = available !== null && isPaid ? available - (Number(days) || 0) : null;

  function decide(decision: "approved" | "denied", fd: FormData) {
    fd.set("decision", decision);
    start(async () => {
      const res = await reviewPtoRequest(id, fd);
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  if (disabled) return <span className="text-xs text-slate-400">{disabledReason}</span>;
  return (
    <form className="flex flex-wrap items-center justify-end gap-2" onSubmit={(e) => e.preventDefault()}>
      <select name="kind" value={paid} onChange={(e) => setPaid(e.target.value)} className={input} aria-label="Paid or unpaid">
        <option value="pto">Paid PTO</option>
        {kind === "vacation" ? <option value="vacation">Vacation (paid)</option> : null}
        <option value="time_off">Unpaid</option>
      </select>
      {isPaid ? (
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input
            name="days"
            type="number"
            min={0}
            max={maxDays}
            step={0.25}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={`${input} w-20`}
            aria-label="PTO days"
          />
          days
        </label>
      ) : null}
      <input name="note" placeholder="Note (optional)" maxLength={1000} className={`${input} w-40`} />
      <button
        type="button"
        disabled={pending}
        onClick={(e) => decide("approved", new FormData(e.currentTarget.form!))}
        className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={(e) => decide("denied", new FormData(e.currentTarget.form!))}
        className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
      >
        Deny
      </button>
      {after !== null ? (
        <span className={`w-full text-right text-xs ${after < 0 ? "text-red-700" : "text-slate-500"}`}>
          Balance after approval: {Math.round(after * 100) / 100} day(s){after < 0 ? " — below zero" : ""}
        </span>
      ) : null}
      {msg ? <span className={`w-full text-right text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
    </form>
  );
}
