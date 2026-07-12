"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type CandidateRow } from "@/lib/ats/types";
import { acceptCandidate, declineCandidate } from "./actions";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unnamed applicant";
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Intake review queue: auto-ingested applicants (Gmail / Indeed) awaiting a
 * recruiter's accept or reject decision. Accepting promotes them to an active
 * lead; rejecting marks them Declined (kept for re-apply detection).
 */
export function IntakeReview({ rows }: { rows: CandidateRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = rows.filter((r) => !done.has(r.id));

  function act(id: string, fn: (personId: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn(id);
      if (res.ok) {
        setDone((prev) => new Set(prev).add(id));
        router.refresh();
      } else {
        setError(res.error);
      }
      setBusyId(null);
    });
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <div className="text-3xl">✅</div>
        <p className="mt-2 text-sm font-medium text-slate-700">Review queue is clear</p>
        <p className="mt-1 text-xs text-slate-500">
          New applications from Gmail and Indeed will appear here for a quick accept or reject.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {visible.map((r) => {
        const rec = r.person_recruiting;
        const source = rec?.source ?? "—";
        const applied = fmtDate(rec?.application_date) ?? fmtDate(r.created_at);
        const isReapply = (rec?.notes ?? "").includes("Re-applied");
        const noContact = !r.email && !r.phone_mobile;
        const busy = busyId === r.id && isPending;

        return (
          <div
            key={r.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/ats/${r.id}`}
                  className="truncate font-semibold text-slate-900 hover:text-emerald-700"
                >
                  {candidateName(r)}
                </Link>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    source === "Indeed"
                      ? "bg-indigo-100 text-indigo-800"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {source}
                </span>
                {isReapply && (
                  <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    🔁 Re-applied
                  </span>
                )}
              </div>

              <div className="mt-1 text-sm text-slate-700">
                <span className="font-medium">
                  {rec?.target_title ?? "Position not specified"}
                </span>
                {applied && <span className="text-slate-400"> · applied {applied}</span>}
              </div>

              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                {r.email && <span>✉️ {r.email}</span>}
                {r.phone_mobile && <span>📞 {r.phone_mobile}</span>}
                {noContact && (
                  <span className="italic text-slate-400">
                    No contact info in email — full details in the Indeed portal
                  </span>
                )}
              </div>

              {rec?.notes && (
                <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-slate-500">{rec.notes}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => act(r.id, acceptCandidate)}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "…" : "✓ Accept"}
              </button>
              <button
                onClick={() => act(r.id, declineCandidate)}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              >
                {busy ? "…" : "✕ Reject"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
