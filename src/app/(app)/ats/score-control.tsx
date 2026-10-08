"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatScore } from "@/lib/ats/types";
import { getScoreHistory, setCandidateScore, type ScoreChange } from "./crm-actions";

function tone(score: number | null): string {
  if (score == null) return "bg-slate-100 text-slate-500 ring-slate-200";
  if (score >= 8) return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (score >= 6) return "bg-sky-100 text-sky-800 ring-sky-200";
  if (score >= 4) return "bg-amber-100 text-amber-800 ring-amber-200";
  return "bg-rose-100 text-rose-700 ring-rose-200";
}

const QUICK = [5, 6, 7, 7.5, 8, 8.5, 9, 10];

/**
 * The Candidate Score (X / 10) as a badge; editors click it to adjust the
 * score with an optional note. Every change is kept in the score history.
 */
export function ScoreControl({
  personId,
  score,
  canEdit,
  size = "sm",
}: {
  personId: string;
  score: number | null | undefined;
  canEdit: boolean;
  size?: "sm" | "md";
}) {
  const incoming = score == null ? null : Number(score);
  const [value, setValue] = useState<number | null>(incoming);
  const [seen, setSeen] = useState<number | null>(incoming);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(incoming == null ? "" : String(incoming));
  // Pick up fresh server data (e.g. the same candidate edited on another row).
  if (incoming !== seen) {
    setSeen(incoming);
    setValue(incoming);
    setDraft(incoming == null ? "" : String(incoming));
  }
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScoreChange[] | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = formatScore(value);
  const badge = (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold tabular-nums ring-1 ${tone(value)} ${size === "md" ? "text-sm" : "text-xs"}`}
    >
      ⭐ {label ? `${label}/10` : "—"}
    </span>
  );
  if (!canEdit) return badge;

  const save = (raw: string) =>
    startTransition(async () => {
      setError(null);
      const res = await setCandidateScore(personId, raw === "" ? null : raw, note || null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setValue(res.score);
      setDraft(res.score == null ? "" : String(res.score));
      setNote("");
      setHistory(null);
      setOpen(false);
    });

  return (
    <span ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="Adjust score"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && history === null) getScoreHistory(personId).then(setHistory);
        }}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {badge}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(draft);
              }}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-sm text-slate-500">/ 10</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setDraft(String(q))}
                className={`rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                  Number(draft) === q ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional) — e.g. Phone interview"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-between gap-2">
            <button
              type="button"
              disabled={pending || value == null}
              onClick={() => save("")}
              className="text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(draft)}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save score"}
            </button>
          </div>
          <div className="border-t border-slate-100 pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">History</p>
            {history === null ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-slate-400">No changes recorded yet.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id} className="text-xs text-slate-600">
                    <span className="font-semibold tabular-nums text-slate-800">
                      {formatScore(h.old_score) ?? "—"} → {formatScore(h.new_score) ?? "—"}
                    </span>
                    {h.note ? ` · ${h.note}` : ""}
                    <span className="block text-[11px] text-slate-400">
                      {h.changed_by_name ?? "Someone"} ·{" "}
                      {new Date(h.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
