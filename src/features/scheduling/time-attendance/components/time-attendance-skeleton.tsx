import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/features/scheduling/shared/components/page-header-skeleton";

const TILES = Array.from({ length: 8 }, (_, i) => i);
const ROWS = Array.from({ length: 6 }, (_, i) => i);

/** Placeholder for Scheduling ▸ Time & Attendance while the day's grades stream in: date nav, mode line, one clinic card. */
export function TimeAttendanceSkeleton() {
  return (
    <div className="space-y-5" aria-busy aria-label="Loading time and attendance">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {TILES.map((i) => (
              <div key={i} className="space-y-1.5 rounded-lg bg-muted px-3 py-2">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-5 w-8" />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="flex gap-3 border-b pb-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
            </div>
            {ROWS.map((i) => (
              <div key={i} className="flex items-center gap-3 border-b pb-2.5 last:border-0">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
