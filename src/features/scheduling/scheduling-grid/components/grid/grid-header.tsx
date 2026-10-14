"use client";

import { DAY_SHORT } from "@/lib/schedule/types";
import { EventHeaderCell } from "@/features/scheduling/scheduling-grid/components/grid/event-header-cell";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import { COL_W, DAYS } from "@/features/scheduling/scheduling-grid/lib/grid-constants";
import type { GridHeader as GridHeaderModel, GridTable } from "@/features/scheduling/scheduling-grid/types/grid-table";

const HATCH =
  "bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)]";

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
      className="sticky left-0 z-20 w-px whitespace-nowrap border-b border-r border-slate-200 bg-white px-4 pb-2 pt-3 text-left align-bottom text-[10px] font-bold uppercase tracking-wider text-slate-500"
    >
      Shift
    </th>
  );

  // Every location toggled off: keep the seven day columns so the grid still
  // reads as a week, with an empty slot where the locations would be.
  if (noLocations) {
    return (
      <thead className="bg-white">
        <tr>
          {shiftHeader}
          {DAYS.map((d) => (
            <th
              key={d}
              className="border-b border-l-2 border-b-slate-200 border-l-slate-300 bg-white px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500"
            >
              {DAY_SHORT[d]}
            </th>
          ))}
        </tr>
        <tr>
          {DAYS.map((d) => (
            <th key={d} className="border-b border-l-2 border-b-slate-100 border-l-slate-300 bg-white px-2 py-1" />
          ))}
        </tr>
        <tr>
          {DAYS.map((d) => (
            <th
              key={d}
              className="border-b border-l-2 border-b-slate-200 border-l-slate-300 bg-white px-2 py-1 text-center text-[10px] text-slate-400"
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
    <thead className="bg-white">
      <tr>
        {shiftHeader}
        {dayHeaders.map((header) => (
          <th
            key={header.id}
            colSpan={header.colSpan}
            className="border-b border-l-2 border-b-slate-100 border-l-slate-300 bg-white px-2 pt-1 text-center"
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
              className={`border-b border-b-slate-200 px-1.5 py-1.5 text-center ${closed ? HATCH : "bg-white"} ${
                dayStarts[i] ? "border-l-2 border-l-slate-300" : "border-l border-l-slate-200"
              }`}
              style={{
                width,
                minWidth: width,
                maxWidth: width,
                borderTop: `3px solid ${closed ? "#cbd5e1" : (meta.location.color ?? "#94a3b8")}`,
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
