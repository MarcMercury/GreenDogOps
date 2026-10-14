import Link from "next/link";
import { cn } from "cn";
import type { PayPeriod } from "@/lib/timeclock/pay-period";
import { shortDateLabel } from "@/lib/worklist/dates";
import { buttonVariants } from "@/components/ui/button";

/** Chips for the recent pay periods; the one on screen is highlighted. */
export function PayPeriodNav({ periods, selectedStart }: { periods: PayPeriod[]; selectedStart: string }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Pay period">
      {periods.map((p) => {
        const selected = p.start === selectedStart;
        return (
          <Link
            key={p.start}
            href={`/schedule/payroll?period=${p.start}`}
            aria-current={selected ? "page" : undefined}
            className={cn(buttonVariants({ variant: selected ? "default" : "outline", size: "sm" }), "rounded-full")}
          >
            {shortDateLabel(p.start)} – {shortDateLabel(p.end)}
          </Link>
        );
      })}
    </nav>
  );
}
