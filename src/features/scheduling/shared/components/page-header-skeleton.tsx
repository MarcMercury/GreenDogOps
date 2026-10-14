import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for `PageHeader` (eyebrow, title, description) while a page streams in. */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  );
}
