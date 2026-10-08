"use client";

import { useState, useTransition } from "react";
import { type PositionRow, positionLabel } from "@/lib/ats/types";
import { assignCandidateJob } from "./actions";

/**
 * A candidate's job, as a dropdown. Changing it saves immediately, logs the
 * move to History and replies in the candidate's Slack thread. Only open jobs
 * are offered; a closed job they're still linked to shows as "(closed)" until
 * they're reassigned. Unlinked legacy candidates show their free-text title.
 */
export function JobQuickSelect({
  personId,
  jobId,
  jobs,
  fallbackLabel,
  canEdit,
  size = "sm",
}: {
  personId: string;
  jobId: string | null;
  jobs: PositionRow[];
  /** Free-text title shown when no job is linked. */
  fallbackLabel?: string | null;
  canEdit: boolean;
  size?: "sm" | "md";
}) {
  const [value, setValue] = useState(jobId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = value ? jobs.find((j) => j.id === value) : undefined;
  const closed = current?.status === "closed";
  const open = jobs.filter((j) => j.status === "open");
  const text = size === "md" ? "text-sm" : "text-xs";
  const tone = !value
    ? "bg-slate-50 text-slate-500 ring-1 ring-slate-200"
    : closed
      ? "bg-slate-100 text-slate-500"
      : "bg-sky-50 text-sky-800";

  const display = current
    ? `${positionLabel(current)}${closed ? " (closed)" : ""}`
    : fallbackLabel
      ? `${fallbackLabel} · no job`
      : "No job";

  if (!canEdit) {
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${text} ${tone}`}>
        {display}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select
        value={value}
        disabled={pending}
        title={error ?? "Assign to a job"}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await assignCandidateJob(personId, next || null);
            if (!res.ok) {
              setValue(prev);
              setError(res.error);
            }
          });
        }}
        className={`max-w-[16rem] cursor-pointer appearance-none truncate rounded-full border-0 py-0.5 pl-2 pr-5 font-medium outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 ${text} ${tone}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath d='M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.25rem center",
          backgroundSize: "0.75rem",
        }}
      >
        <option value="">{fallbackLabel ? `${fallbackLabel} · no job` : "No job"}</option>
        {closed && current && (
          <option value={current.id} disabled>
            {positionLabel(current)} (closed)
          </option>
        )}
        {open.map((j) => (
          <option key={j.id} value={j.id}>
            {positionLabel(j)}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-xs text-red-600" title={error}>
          ⚠
        </span>
      )}
    </span>
  );
}
