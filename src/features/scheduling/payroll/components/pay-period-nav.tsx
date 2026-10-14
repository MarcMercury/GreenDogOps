import Link from "next/link";
import type { PayPeriod } from "@/lib/timeclock/pay-period";
import { shortDateLabel } from "@/lib/worklist/dates";

/** Chips for the recent pay periods; the one on screen is highlighted. */
export function PayPeriodNav({ periods, selectedStart }: { periods: PayPeriod[]; selectedStart: string }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Pay period">
      {periods.map((p) => (
        <Link
          key={p.start}
          href={`/schedule/payroll?period=${p.start}`}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            p.start === selectedStart ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          {shortDateLabel(p.start)} – {shortDateLabel(p.end)}
        </Link>
      ))}
    </nav>
  );
}
