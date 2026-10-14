import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/features/scheduling/shared/components/page-header-skeleton";

/** Placeholder for the three approver queues while the page's data streams in. */
export function TimeClockSkeleton() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      {[0, 1, 2].map((section) => (
        <Card key={section}>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-4 w-40" />
            </CardTitle>
            <CardAction>
              <Skeleton className="h-3 w-20" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {[0, 1].map((row) => (
              <div key={row} className="grid gap-3 md:grid-cols-[1fr_18rem]">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-72 max-w-full" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
