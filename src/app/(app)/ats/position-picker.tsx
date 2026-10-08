"use client";

import { useState } from "react";
import { type PositionRow, positionLabel } from "@/lib/ats/types";

const OTHER = "__other__";

/**
 * Pick the job a candidate is for. Submits `target_position_id` plus a synced
 * `target_title` (the free-text title older screens and imports read).
 * "No job — other title…" keeps a free-text title with no linked job.
 * Only open jobs are offered, plus whichever one is already linked.
 */
export function PositionPicker({
  positions,
  defaultPositionId,
  defaultTitle,
  className,
  labelClassName,
}: {
  positions: PositionRow[];
  defaultPositionId?: string | null;
  defaultTitle?: string | null;
  className: string;
  labelClassName: string;
}) {
  const options = positions.filter((p) => p.status === "open" || p.id === defaultPositionId);
  const initial =
    defaultPositionId && options.some((p) => p.id === defaultPositionId)
      ? defaultPositionId
      : defaultTitle
        ? OTHER
        : "";
  const [choice, setChoice] = useState(initial);
  const [title, setTitle] = useState(defaultTitle ?? "");

  const picked = options.find((p) => p.id === choice);
  const submittedTitle = picked ? picked.title : choice === OTHER ? title : "";

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className={labelClassName}>Job</span>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className={className}
        >
          <option value="">— No job —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {positionLabel(p)}
              {p.status === "closed" ? " (closed)" : ""}
            </option>
          ))}
          <option value={OTHER}>No job — other title…</option>
        </select>
      </label>
      {choice === OTHER && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Role title"
          className={className}
        />
      )}
      <input type="hidden" name="target_position_id" value={picked ? picked.id : ""} />
      <input type="hidden" name="target_title" value={submittedTitle} />
    </div>
  );
}
