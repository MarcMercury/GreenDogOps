"use client";

import { useState } from "react";
import { type PositionRow, positionLabel } from "@/lib/ats/types";

const OTHER = "__other__";

/**
 * Pick the open position a candidate is for. Submits `target_position_id` plus
 * a synced `target_title` (the free-text title older screens and imports read).
 * "Other…" keeps a free-text title with no linked position.
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
  // Offer open/on-hold positions, plus whichever one is already linked.
  const options = positions.filter(
    (p) => p.status === "open" || p.status === "on_hold" || p.id === defaultPositionId,
  );
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
        <span className={labelClassName}>Position</span>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className={className}
        >
          <option value="">—</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {positionLabel(p)}
              {p.status === "on_hold" ? " (on hold)" : ""}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </label>
      {choice === OTHER && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Position title"
          className={className}
        />
      )}
      <input type="hidden" name="target_position_id" value={picked ? picked.id : ""} />
      <input type="hidden" name="target_title" value={submittedTitle} />
    </div>
  );
}
