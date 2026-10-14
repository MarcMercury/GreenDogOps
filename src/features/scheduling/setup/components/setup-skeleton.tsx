import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/features/scheduling/shared/components/page-header-skeleton";
import { SUB_TABS } from "@/features/scheduling/setup/lib/sub-tabs";

/**
 * Placeholder for Scheduling ▸ Set Up while the page streams in: the header,
 * the sub-tab strip and the two-column list + form layout of the first tab.
 * A server component (the route's `loading.tsx` renders it), so only plain
 * elements and `Skeleton` — no Base UI primitives.
 */
export function SetupSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading Set Up">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((t) => (
          <Skeleton key={t.key} className="h-7 w-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-24" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
