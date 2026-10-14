import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, shortDateLabel } from "@/lib/worklist/dates";

/** Step a day back or forward; "Today" jumps back when another day is open. */
export function DateNav({ date, today }: { date: string; today: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        variant="outline"
        render={<Link href={`/schedule/time-attendance?date=${addDays(date, -1)}`} />}
      >
        <ChevronLeft aria-hidden />
        {shortDateLabel(addDays(date, -1))}
      </Button>
      {/* The open day. `badgeVariants` (not `Badge`) because this is a server component. */}
      <span className={badgeVariants({ variant: "default", className: "h-8 px-3 text-sm font-semibold" })}>
        {shortDateLabel(date)}
        {date === today ? " · Today" : ""}
      </span>
      <Button
        variant="outline"
        render={<Link href={`/schedule/time-attendance?date=${addDays(date, 1)}`} />}
      >
        {shortDateLabel(addDays(date, 1))}
        <ChevronRight aria-hidden />
      </Button>
      {date !== today ? (
        <Button variant="link" className="text-emerald-700" render={<Link href="/schedule/time-attendance" />}>
          Today
        </Button>
      ) : null}
    </div>
  );
}
