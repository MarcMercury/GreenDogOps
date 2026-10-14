"use client";

/** Key to the chip colours and markers used on the grid. */
export function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 print:hidden">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-200" />
        Scheduled
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded ring-1 ring-sky-400" />
        Added after publish
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-sky-100 ring-1 ring-sky-400" />
        Changed since submitted
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-amber-100" /> Late
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-red-100" /> Absent
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-violet-100" /> PTO
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-red-100 ring-1 ring-red-500" />
        <span className="text-red-600">⚠</span> Double-booked
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded bg-violet-100 ring-1 ring-violet-500" />
        <span className="text-violet-600">🌴</span> Scheduled on time off
      </span>
      <span className="ml-2">
        Number next to a name = shifts already assigned that week.
      </span>
    </div>
  );
}
