import { CalendarDaysIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** The grid page's body when no schedule week exists yet (or the requested one is gone). */
export function EmptyWeekState() {
  return (
    <Empty className="border border-dashed bg-white">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDaysIcon />
        </EmptyMedia>
        <EmptyTitle>No schedule week yet</EmptyTitle>
        <EmptyDescription>Pick a week in the calendar to open or create one.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
