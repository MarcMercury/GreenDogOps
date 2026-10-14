import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { shortDateLabel } from "@/lib/worklist/dates";

/** Shown instead of the clinic sections when nothing is published for the day. */
export function NoShiftsNotice({ date }: { date: string }) {
  return (
    <Empty className="border bg-card p-8">
      <EmptyHeader>
        <EmptyDescription>No published shifts on {shortDateLabel(date)}.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
