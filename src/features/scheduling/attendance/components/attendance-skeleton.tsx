import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/features/scheduling/shared/components/page-header-skeleton";

const ROWS = Array.from({ length: 8 }, (_, i) => i);

/** Placeholder for Scheduling ▸ Attendance while the rollup streams in: the four totals, the filter row and the table. */
export function AttendanceSkeleton() {
  return (
    <div className="space-y-5" aria-busy aria-label="Loading attendance">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} size="sm">
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex gap-3 border-b bg-muted/50 px-3 py-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
          </div>
          {ROWS.map((i) => (
            <div key={i} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-0">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
