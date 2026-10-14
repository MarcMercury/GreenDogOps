import { Skeleton } from "@/components/ui/skeleton";

const HEADER_COLS = 7;
const BODY_ROWS = 10;
const CALENDAR_WEEKS = 6;
const ROW_ENTRIES = 8;

/** Placeholder for the schedule page — sidebar cards and the weekly grid — while the week's data streams in. */
export function GridSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[21rem_minmax(0,1fr)]" aria-busy>
      <aside className="space-y-4">
        <div className="space-y-4 rounded-xl bg-white p-4 ring-1 ring-foreground/10">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: CALENDAR_WEEKS }, (_, w) => (
              <div key={w} className="flex items-center gap-1">
                <Skeleton className="size-2 rounded-full" />
                {Array.from({ length: 7 }, (_, d) => (
                  <Skeleton key={d} className="size-9 flex-1 rounded-md" />
                ))}
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-foreground/10">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-28" />
          </div>
          {Array.from({ length: ROW_ENTRIES }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ml-auto h-8 w-40" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-28 rounded-full" />
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="grid gap-px bg-slate-100" style={{ gridTemplateColumns: `12rem repeat(${HEADER_COLS}, 1fr)` }}>
            {Array.from({ length: HEADER_COLS + 1 }, (_, i) => (
              <Skeleton key={`h-${i}`} className="h-12 rounded-none" />
            ))}
            {Array.from({ length: BODY_ROWS * (HEADER_COLS + 1) }, (_, i) => (
              <div key={`c-${i}`} className="bg-white p-1">
                <Skeleton className="h-7 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
