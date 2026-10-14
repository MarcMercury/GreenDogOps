"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMissingPunch } from "@/features/scheduling/time-clock/actions/punch-actions";
import { ActionStatus } from "@/features/scheduling/time-clock/components/action-status";

/** Collapsed button that opens the "add the missing punch" form for one day. */
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
      <ActionStatus result={result} />
    </form>
  );
}
