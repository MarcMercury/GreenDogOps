"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridHeaderContext } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * A location's header on one day: its short code, which toggles the clinic
 * closed (struck through, narrow column) or open. The `<th>` around it is
 * drawn by `GridHeader`, which knows the column width.
 */
export function LocationHeaderCell({ column }: GridHeaderContext) {
  const { closureSet, actions } = useGrid();
  const meta = column.columnDef.meta;
  if (meta?.kind !== "cell") return null;
  const { day, location } = meta;
  const closed = closureSet.has(`${location.id}|${day}`);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => actions.toggleClosure(location.id, day)}
            className={
              closed
                ? "mx-auto block max-h-[64px] overflow-hidden text-[9px] font-semibold text-slate-400 line-through [writing-mode:vertical-rl]"
                : "block w-full truncate text-[10px] font-semibold text-slate-500 hover:text-emerald-600"
            }
          />
        }
      >
        {location.short_code ?? location.name}
      </TooltipTrigger>
      <TooltipContent>{closed ? "Re-open location" : "Close location"}</TooltipContent>
    </Tooltip>
  );
}
