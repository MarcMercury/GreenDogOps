import { Skeleton } from "@/components/ui/skeleton";

const HEADER_COLS = 7;
const BODY_ROWS = 10;

/** Placeholder for the weekly grid while the week's data streams in. */
export function GridSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-8" />
        <div className="flex flex-1 gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16" />
          ))}
        </div>
        <Skeleton className="size-8" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid gap-px bg-slate-100" style={{ gridTemplateColumns: `12rem repeat(${HEADER_COLS}, 1fr)` }}>
          {Array.from({ length: HEADER_COLS + 1 }, (_, i) => (
            <Skeleton key={`h-${i}`} className="h-9 rounded-none" />
          ))}
          {Array.from({ length: BODY_ROWS * (HEADER_COLS + 1) }, (_, i) => (
            <div key={`c-${i}`} className="bg-white p-1">
              <Skeleton className="h-7 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
