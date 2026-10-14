import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeaderSkeleton } from "@/features/scheduling/shared/components/page-header-skeleton";

const COLUMNS = 8;

/** Placeholder for the Payroll page (period chips, summary card, timecard table) while it streams in. */
export function PayrollSkeleton() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-7 w-32 rounded-full" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-4 w-64" />
          </CardTitle>
          <Skeleton className="h-5 w-40" />
          <CardAction className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-20" />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-12 rounded-lg" />
        </CardContent>
      </Card>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: COLUMNS }, (_, i) => (
                <TableHead key={i}>
                  <Skeleton className="h-3 w-16" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2, 3, 4].map((row) => (
              <TableRow key={row}>
                {Array.from({ length: COLUMNS }, (_, i) => (
                  <TableCell key={i}>
                    <Skeleton className={i === 0 ? "h-4 w-40" : "h-4 w-12"} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
