"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideCorrection } from "@/features/scheduling/time-clock/actions/correction-actions";
import { ActionStatus } from "@/features/scheduling/time-clock/components/action-status";
import type { CorrectionTarget } from "@/features/scheduling/time-clock/types/correction-target";

/** Approve / deny one correction request (a note is required to deny). */
export function CorrectionDecision({
  requestId,
  needsTarget,
  targets,
}: {
  requestId: string;
  /** "Wrong time" requests replace one of the day's punches. */
  needsTarget: boolean;
  targets: CorrectionTarget[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState("");
  const [target, setTarget] = useState(targets.length === 1 ? targets[0].value : "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (decision: "approved" | "denied") =>
    start(async () => {
      const res = await decideCorrection(requestId, decision, note.trim(), decision === "approved" && needsTarget ? target || null : null);
      setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  return (
    <div className="space-y-2">
      {needsTarget ? (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">Replace which punch?</option>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      ) : null}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        placeholder="Note to the employee (required to deny)"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || (needsTarget && !target)}
          onClick={() => run("approved")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy || note.trim().length === 0}
          onClick={() => run("denied")}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Deny
        </button>
      </div>
      <ActionStatus result={result} />
    </div>
  );
}
