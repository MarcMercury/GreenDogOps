"use client";

import { useState, useTransition } from "react";
import {
  RECRUITING_STAGE_OPTIONS,
  STAGE_BADGE,
  bucketForStage,
} from "@/lib/ats/types";
import { updateCandidateStage } from "./actions";

/**
 * The stage pill, as a dropdown. Changing it saves immediately, logs the move
 * to History and replies in the candidate's Slack thread. Legacy free-text
 * stages still show as the current value until someone picks a new one.
 */
export function StageQuickSelect({
  personId,
  stage,
  canEdit,
}: {
  personId: string;
  stage: string | null;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(stage ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const badge = STAGE_BADGE[bucketForStage(value || null)];

  if (!canEdit) {
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
        {stage ?? "—"}
      </span>
    );
  }

  const isLegacy = value !== "" && !(RECRUITING_STAGE_OPTIONS as readonly string[]).includes(value);

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select
        value={value}
        disabled={pending}
        title={error ?? "Change stage"}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await updateCandidateStage(personId, next);
            if (!res.ok) {
              setValue(prev);
              setError(res.error);
            }
          });
        }}
        className={`cursor-pointer appearance-none rounded-full border-0 py-0.5 pl-2 pr-5 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 ${badge}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath d='M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.25rem center",
          backgroundSize: "0.75rem",
        }}
      >
        {value === "" && <option value="">— Set stage —</option>}
        {isLegacy && <option value={value}>{value}</option>}
        {RECRUITING_STAGE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
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
