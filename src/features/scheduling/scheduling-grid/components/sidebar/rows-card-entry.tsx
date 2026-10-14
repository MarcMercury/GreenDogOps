"use client";

import { useState } from "react";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { RowsCardLineToggle } from "@/features/scheduling/scheduling-grid/components/sidebar/rows-card-line-toggle";

export interface RowsCardLine {
  id: string;
  label: string;
  time: string;
}

/**
 * One section of the grid in the Rows card: a checkbox that shows or hides
 * the whole section, its colour and name, and — when it has shift lines — a
 * chevron that reveals a checkbox per line and a "shown / total" count.
 */
export function RowsCardEntry({
  id,
  name,
  color,
  lines,
  hidden,
  hiddenLines,
  onToggle,
  onToggleLine,
}: {
  id: string;
  name: string;
  color: string;
  lines: RowsCardLine[];
  hidden: boolean;
  hiddenLines: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleLine: (lineId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shownLines = lines.filter((l) => !hiddenLines.has(l.id)).length;
  const status = hidden ? "Hidden" : lines.length ? `${shownLines}/${lines.length}` : "Shown";

  return (
    <li>
      <div className="flex items-center gap-2 py-1.5">
        {lines.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide ${name}'s rows` : `Show ${name}'s rows`}
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-400 transition hover:text-slate-700"
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="size-3.5" aria-hidden />
        )}
        <Checkbox checked={!hidden} onCheckedChange={() => onToggle(id)} aria-label={`Show ${name}`} />
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className={cn("flex-1 truncate text-sm font-medium", hidden ? "text-slate-400" : "text-slate-800")}>
          {name}
        </span>
        <span className="text-xs text-slate-500 tabular-nums">{status}</span>
      </div>
      {expanded && lines.length > 0 && (
        <ul className="mb-1 ml-[1.1rem] border-l border-slate-200 pl-3">
          {lines.map((line) => (
            <RowsCardLineToggle
              key={line.id}
              id={line.id}
              label={line.label}
              time={line.time}
              shown={!hidden && !hiddenLines.has(line.id)}
              onToggle={onToggleLine}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
