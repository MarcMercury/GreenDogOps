"use client";

import type { ScheduleLocation } from "@/lib/schedule/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { COL_W } from "@/features/scheduling/scheduling-grid/lib/grid-constants";

/**
 * The event banner slot above a location/day column: the event's title in the
 * clinic's colour, or an invisible "+ event" that appears on hover. This row
 * is not one of the table's header groups — it is drawn once per visible
 * location column between the day and location header rows.
 */
export function EventHeaderCell({
  day,
  location,
  isDayStart,
}: {
  day: number;
  location: ScheduleLocation;
  isDayStart: boolean;
}) {
  const { closureSet, eventMap, actions } = useGrid();
  const event = eventMap.get(`${location.id}|${day}`);
  const closed = closureSet.has(`${location.id}|${day}`);
  const width = closed ? 18 : COL_W;
  return (
    <th
      className={`border-b border-b-slate-100 bg-white p-0.5 align-middle ${
        isDayStart ? "border-l-2 border-l-slate-300" : "border-l border-l-slate-200"
      }`}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => actions.openEventModal(location.id, day, event?.title ?? "")}
              className={`flex min-h-[18px] w-full items-center justify-center truncate rounded px-1 py-0.5 text-center text-[9px] font-semibold leading-tight transition ${
                event
                  ? "text-white"
                  : "text-transparent hover:bg-slate-100 hover:text-slate-400 print:hidden"
              }`}
              style={event ? { backgroundColor: location.color ?? "#64748b" } : undefined}
            />
          }
        >
          {event ? event.title : "+ event"}
        </TooltipTrigger>
        <TooltipContent>
          {event ? `Edit event: ${event.title}` : "Add an event for this location/day"}
        </TooltipContent>
      </Tooltip>
    </th>
  );
}
