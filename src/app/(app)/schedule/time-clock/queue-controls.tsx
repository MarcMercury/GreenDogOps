"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMissingPunch, decideCorrection, reviewOffsitePunch } from "./actions";

function Status({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
      {result.text}
    </p>
  );
}

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
      <Status result={result} />
    </div>
  );
}

export function CorrectionDecision({
  requestId,
  needsTarget,
  targets,
}: {
  requestId: string;
  /** "Wrong time" requests replace one of the day's punches. */
  needsTarget: boolean;
  targets: { value: string; label: string }[];
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
      <Status result={result} />
    </div>
  );
}

export function AddPunchForm({
  personId,
  workDate,
  defaultType,
}: {
  personId: string;
  workDate: string;
  defaultType: "clock_in" | "clock_out";
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Add the missing punch
      </button>
    );
  }
  return (
    <form
      className="space-y-2"
      action={(fd) =>
        start(async () => {
          const res = await addMissingPunch(fd);
          setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        })
      }
    >
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="work_date" value={workDate} />
      <div className="flex flex-wrap gap-2">
        <select name="punch_type" defaultValue={defaultType} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="clock_in">Clock in</option>
          <option value="lunch_start">Start lunch</option>
          <option value="lunch_end">End lunch</option>
          <option value="clock_out">Clock out</option>
        </select>
        <input type="time" name="time" required className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" name="next_day" /> after midnight
        </label>
      </div>
      <input
        name="reason"
        required
        maxLength={1000}
        placeholder="Reason (e.g. confirmed with the employee)"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Add punch
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-xs text-slate-500 hover:text-slate-800">
          Cancel
        </button>
      </div>
      <Status result={result} />
    </form>
  );
}
