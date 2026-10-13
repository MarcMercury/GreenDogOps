"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeMealWaiver, signMealWaiver } from "../actions";

export function SignWaiverForm({ kind, versionId, title }: { kind: string; versionId: string; title: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>
          I have read the {title}. I understand signing is voluntary, is not a condition of my job, and that I can
          revoke it at any time.
        </span>
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Type your first and last name to sign</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          autoComplete="name"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:max-w-sm"
        />
      </label>
      <button
        type="button"
        disabled={busy || !agreed || name.trim().length < 3}
        onClick={() =>
          start(async () => {
            const res = await signMealWaiver({ kind, versionId, typedName: name, agreed });
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Signing…" : "Sign the waiver"}
      </button>
      {msg ? <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p> : null}
    </div>
  );
}

export function RevokeWaiverButton({ kind }: { kind: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="space-x-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!window.confirm("Revoke this waiver? It stops applying right away, for your next shifts.")) return;
          start(async () => {
            const res = await revokeMealWaiver(kind);
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          });
        }}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span> : null}
    </span>
  );
}
