"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestPto, withdrawPto } from "../actions";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

function spanDays(start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function PtoRequestForm({ minDate, maxDate, today }: { minDate: string; maxDate: string; today: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const span = spanDays(from, to);

  return (
    <form
      ref={formRef}
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          const res = await requestPto(fd);
          setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
          if (res.ok) {
            formRef.current?.reset();
            setFrom(today);
            setTo(today);
            setDays("");
            router.refresh();
          }
        })
      }
    >
      <p className="text-sm text-slate-600">
        Sick time and planned time off are both taken in whole days (1 day = 8 hours).
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-slate-700">First day</span>
          <input
            type="date"
            name="start_date"
            required
            min={minDate}
            max={maxDate}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (to < e.target.value) setTo(e.target.value);
            }}
            className={field}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Last day</span>
          <input
            type="date"
            name="end_date"
            required
            min={from || minDate}
            max={maxDate}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={field}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">PTO days to use</span>
          <input
            type="number"
            name="days"
            min={1}
            max={span || 1}
            step={1}
            placeholder={span ? String(span) : ""}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={field}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Leave blank for all {span || ""} day{span === 1 ? "" : "s"}; lower it if some are your regular days off.
          </span>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-slate-700">Note for your manager (optional)</span>
        <textarea name="note" rows={2} maxLength={500} className={field} />
        <span className="mt-1 block text-xs text-slate-500">You don&apos;t need to give a reason.</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Request PTO"}
        </button>
        {result ? <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.text}</p> : null}
      </div>
    </form>
  );
}

export function WithdrawPtoButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!window.confirm("Withdraw this request?")) return;
            const res = await withdrawPto(id);
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
        className="text-xs font-medium text-slate-500 underline hover:text-red-700 disabled:opacity-50"
      >
        Withdraw
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
