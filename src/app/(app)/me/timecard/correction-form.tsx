"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTimeCorrection, requestTimeCorrection } from "../actions";

export function CorrectionForm({ minDate, maxDate }: { minDate: string; maxDate: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState("missing_punch");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      ref={formRef}
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          const res = await requestTimeCorrection(fd);
          setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
          if (res.ok) {
            formRef.current?.reset();
            setKind("missing_punch");
            router.refresh();
          }
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-700">Day of the shift</span>
          <input
            type="date"
            name="work_date"
            required
            min={minDate}
            max={maxDate}
            defaultValue={maxDate}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">What needs fixing</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="missing_punch">I forgot to punch</option>
            <option value="wrong_time">A punch has the wrong time</option>
            <option value="other">Something else</option>
          </select>
        </label>
        {kind !== "other" ? (
          <>
            <label className="block text-sm">
              <span className="text-slate-700">Which punch</span>
              <select name="punch_type" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="clock_out">Clock out</option>
                <option value="clock_in">Clock in</option>
                <option value="lunch_start">Start lunch</option>
                <option value="lunch_end">End lunch</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Correct time</span>
              <input type="time" name="time" required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="next_day" /> after midnight (overnight shift)
              </span>
            </label>
          </>
        ) : null}
      </div>
      <label className="block text-sm">
        <span className="text-slate-700">What happened</span>
        <textarea
          name="reason"
          required
          maxLength={1000}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          placeholder="e.g. My phone died before I could clock out."
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send to my manager"}
      </button>
      {result ? (
        <p role="status" className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
          {result.text}
        </p>
      ) : null}
    </form>
  );
}

export function CancelCorrectionButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelTimeCorrection(id);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
        className="text-xs text-slate-500 underline hover:text-slate-800 disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {error ? <span className="ml-2 text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
