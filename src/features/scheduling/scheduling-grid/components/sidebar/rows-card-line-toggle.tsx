"use client";

import { Checkbox } from "@/components/ui/checkbox";

/** One shift line in the Rows card: show / hide it on the grid. */
export function RowsCardLineToggle({
  id,
  label,
  time,
  shown,
  onToggle,
}: {
  id: string;
  label: string;
  time: string;
  shown: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1">
      <Checkbox checked={shown} onCheckedChange={() => onToggle(id)} aria-label={`Show ${label}`} />
      <span className="flex-1 truncate text-sm text-slate-700">{label}</span>
      <span className="font-mono text-[11px] text-slate-500">{time}</span>
    </li>
  );
}
