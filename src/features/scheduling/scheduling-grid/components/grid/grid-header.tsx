"use client";

import { DAY_SHORT } from "@/lib/schedule/types";
import { EventHeaderCell } from "@/features/scheduling/scheduling-grid/components/grid/event-header-cell";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { COL_W, DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import type { GridHeader as GridHeaderModel, GridTable } from "@/features/scheduling/scheduling-grid/types/grid-table";

/**
 * The three header rows: the day groups (from the table's header groups), the
 * event banners (one slot per visible location column) and the location
 * toggles (the leaf headers). The "Shift" column header spans all three.
 */
export function GridHeader({ table, leafHeaders }: { table: GridTable; leafHeaders: GridHeaderModel[] }) {
  const { closureSet } = useGrid();
  const [dayGroupRow] = table.getHeaderGroups();
  const dayHeaders = (dayGroupRow?.headers ?? []).filter((h) => h.column.columnDef.meta?.kind === "day");
  const noLocations = leafHeaders.length === 0;

  const shiftHeader = (
    <th
      rowSpan={3}
      className="sticky left-0 z-20 w-px whitespace-nowrap border-b border-r border-slate-300 bg-slate-50 px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-500"
    >
      Shift
    </th>
  );

  // Every location toggled off: keep the seven day columns so the grid still
  // reads as a week, with an empty slot where the locations would be.
  if (noLocations) {
    return (
      <thead>
        <tr>
          {shiftHeader}
          {DAYS.map((d) => (
            <th
              key={d}
              className="border-b border-l-2 border-b-slate-300 border-l-slate-400 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
            >
              {DAY_SHORT[d]}
            </th>
          ))}
        </tr>
        <tr>
          {DAYS.map((d) => (
            <th key={d} className="border-b border-l-2 border-b-slate-200 border-l-slate-400 bg-slate-50 px-2 py-1" />
          ))}
        </tr>
        <tr>
          {DAYS.map((d) => (
            <th
              key={d}
              className="border-b border-l-2 border-b-slate-300 border-l-slate-400 bg-slate-50 px-2 py-1 text-center text-[10px] text-slate-400"
            >
              —
            </th>
          ))}
        </tr>
      </thead>
    );
  }

  // A column starts a day when the column before it belongs to another day.
  const dayOf = (h: GridHeaderModel | undefined) => {
    const meta = h?.column.columnDef.meta;
    return meta?.kind === "cell" ? meta.day : null;
  };
  const dayStarts = leafHeaders.map((h, i) => dayOf(h) !== dayOf(leafHeaders[i - 1]));

  return (
    <thead>
      <tr>
        {shiftHeader}
        {dayHeaders.map((header) => (
          <th
            key={header.id}
            colSpan={header.colSpan}
            className="border-b border-l-2 border-b-slate-300 border-l-slate-400 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
          >
            <table.FlexRender header={header} />
          </th>
        ))}
      </tr>
      <tr>
        {leafHeaders.map((header, i) => {
          const meta = header.column.columnDef.meta;
          if (meta?.kind !== "cell") return null;
          return (
            <EventHeaderCell key={header.id} day={meta.day} location={meta.location} isDayStart={dayStarts[i]} />
          );
        })}
      </tr>
      <tr>
        {leafHeaders.map((header, i) => {
          const meta = header.column.columnDef.meta;
          if (meta?.kind !== "cell") return null;
          const closed = closureSet.has(`${meta.location.id}|${meta.day}`);
          const width = closed ? 18 : COL_W;
          return (
            <th
              key={header.id}
              className={`border-b border-b-slate-300 bg-slate-50 px-1.5 py-1 text-center ${
                dayStarts[i] ? "border-l-2 border-l-slate-400" : "border-l border-l-slate-300"
              }`}
              style={{
                width,
                minWidth: width,
                maxWidth: width,
                borderTop: `2px solid ${meta.location.color ?? "#94a3b8"}`,
              }}
            >
              <table.FlexRender header={header} />
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
