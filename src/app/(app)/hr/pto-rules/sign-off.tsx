"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOffRules } from "./actions";

export function SignOffButton({ version }: { version: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!window.confirm("Sign off that you've reviewed these rules and they match company policy and payroll practice?")) return;
            const res = await signOffRules(version);
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          })
        }
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Sign off this version
      </button>
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
    </span>
  );
}
