"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewOffsitePunch } from "@/features/scheduling/time-clock/actions/offsite-actions";
import { ActionStatus } from "@/features/scheduling/time-clock/components/action-status";

/** Approve / reject one off-site punch (a note is required to reject). */
export function OffsiteDecision({ punchId }: { punchId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await reviewOffsitePunch(punchId, decision, note.trim());
      setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  return (
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        placeholder="Note (required to reject)"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run("approved")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy || note.trim().length === 0}
          onClick={() => run("rejected")}
          title="Rejecting removes the punch from the timecard"
          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      <ActionStatus result={result} />
    </div>
  );
}
