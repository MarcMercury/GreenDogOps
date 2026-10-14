"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveTimecard,
  completePayrollReview,
  lockPayPeriod,
  overridePayroll,
  reopenPayPeriod,
  reopenPayrollReview,
  unapproveTimecard,
} from "./actions";

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

const OVERRIDE_OPTIONS: { value: string; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "overtime", label: "Overtime 1.5x" },
  { value: "double_time", label: "Double time 2x" },
  { value: "meal_premium", label: "Meal premium" },
  { value: "pto", label: "PTO" },
];

/** Payroll Review: change one hours bucket (blank = back to calculated) with a reason. */
export function OverrideForm({ period, personId, disabled }: { period: string; personId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (disabled) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-emerald-700 hover:underline">
        Adjust
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex flex-wrap items-center justify-end gap-1.5"
      action={(fd) =>
        start(async () => {
          const res = await overridePayroll(period, personId, String(fd.get("field")), String(fd.get("hours") ?? ""), String(fd.get("reason") ?? ""));
          setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
          if (res.ok) {
            setOpen(false);
            router.refresh();
          }
        })
      }
    >
      <select name="field" className="rounded border border-slate-300 px-1.5 py-1 text-xs" aria-label="Pay line">
        {OVERRIDE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input name="hours" type="number" min={0} max={400} step={0.01} placeholder="hours (blank = calculated)" className="w-36 rounded border border-slate-300 px-1.5 py-1 text-xs" />
      <input name="reason" required maxLength={1000} placeholder="Reason (required)" className="w-44 rounded border border-slate-300 px-1.5 py-1 text-xs" />
      <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">
        Cancel
      </button>
      <Note msg={msg} />
    </form>
  );
}

/** Payroll Review: leave an employee out of (or back into) the ADP file, with a reason. */
export function ExcludeButton({ period, personId, excluded }: { period: string; personId: string; excluded: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt(
            excluded ? "Why put this employee back in the ADP file?" : "Why leave this employee out of the ADP file? (e.g. salaried, paid outside RUN)",
          );
          if (!reason?.trim()) return;
          start(async () => {
            const res = await overridePayroll(period, personId, "exclude", excluded ? "0" : "1", reason);
            setMsg(res.ok ? null : { ok: false, text: res.error });
            router.refresh();
          });
        }}
        className="text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-50"
      >
        {excluded ? "Include" : "Leave out"}
      </button>
      <Note msg={msg} />
    </span>
  );
}

function StepButton({
  label,
  confirm,
  run,
  disabled,
  title,
  tone = "dark",
}: {
  label: string;
  confirm?: string;
  run: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  disabled?: boolean;
  title?: string;
  tone?: "dark" | "light";
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy || disabled}
        title={title}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await run();
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            router.refresh();
          });
        }}
        className={
          tone === "dark"
            ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            : "rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {busy ? "…" : label}
      </button>
      <Note msg={msg} />
    </span>
  );
}

export function CompleteReviewButton({ period, blockers }: { period: string; blockers: string[] }) {
  return (
    <StepButton
      label="Complete review"
      disabled={blockers.length > 0}
      title={blockers.join(" ")}
      confirm="Complete the payroll review? These hours are frozen and become the ADP RUN file."
      run={() => completePayrollReview(period)}
    />
  );
}

export function BackToReviewButton({ period }: { period: string }) {
  return <StepButton label="Back to review" tone="light" run={() => reopenPayrollReview(period)} />;
}
