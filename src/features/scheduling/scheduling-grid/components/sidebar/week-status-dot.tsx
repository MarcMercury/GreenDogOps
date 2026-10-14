import { cn } from "cn";
import type { ScheduleStatus } from "@/lib/schedule/types";
import { NOT_CREATED_DOT, WEEK_STATUS_DOT } from "@/features/scheduling/scheduling-grid/lib/week-status-style";

/** A week's status as a dot: coloured when the week exists, hollow when it does not. */
export function WeekStatusDot({ status, className }: { status: ScheduleStatus | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", status ? WEEK_STATUS_DOT[status] : NOT_CREATED_DOT, className)}
    />
  );
}
