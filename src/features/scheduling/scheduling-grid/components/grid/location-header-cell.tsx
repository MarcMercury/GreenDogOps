"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridHeaderContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * A location's header on one day: its short code, which toggles the clinic
 * closed (struck through, narrow column) or open. When the whole day is
 * closed the cells are blank hatching and the day header says CLOSED. The
 * `<th>` around it is drawn by `GridHeader`, which knows the column width.
 */
export function LocationHeaderCell({ column }: GridHeaderContext) {
  const { closureSet, canEdit, actions } = useGrid();
  const meta = column.columnDef.meta;
  if (meta?.kind !== "cell") return null;
  const { day, location } = meta;
  const closed = closureSet.has(`${location.id}|${day}`);
  const siblings = column.parent?.columns.filter((c) => c.getIsVisible()) ?? [];
  const dayClosed =
    closed &&
    siblings.every((c) => {
      const m = c.columnDef.meta;
      return m?.kind === "cell" && closureSet.has(`${m.location.id}|${day}`);
    });
  const label = location.short_code ?? location.name;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => actions.toggleClosure(location.id, day)}
            aria-label={`${label}: ${closed ? "closed — re-open" : "open — close"}`}
            className={
              dayClosed
                ? "block h-10 w-full"
                : closed
                  ? "mx-auto block max-h-[64px] overflow-hidden text-[9px] font-semibold text-slate-400 line-through [writing-mode:vertical-rl]"
                  : "block w-full truncate text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 disabled:hover:text-slate-500"
            }
          />
        }
      >
        {dayClosed ? "" : label}
      </TooltipTrigger>
      <TooltipContent>
        {closed ? `Re-open ${location.name}` : `Close ${location.name}`}
      </TooltipContent>
    </Tooltip>
  );
}
