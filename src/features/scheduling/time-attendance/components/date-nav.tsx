import Link from "next/link";
import { addDays, shortDateLabel } from "@/lib/worklist/dates";

/** Step a day back or forward; "Today" jumps back when another day is open. */
export function DateNav({ date, today }: { date: string; today: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link
        href={`/schedule/time-attendance?date=${addDays(date, -1)}`}
        className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
      >
        ← {shortDateLabel(addDays(date, -1))}
      </Link>
      <span className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white">
        {shortDateLabel(date)}
        {date === today ? " · Today" : ""}
      </span>
      <Link
        href={`/schedule/time-attendance?date=${addDays(date, 1)}`}
        className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
      >
        {shortDateLabel(addDays(date, 1))} →
      </Link>
      {date !== today ? (
        <Link href="/schedule/time-attendance" className="text-emerald-700 hover:underline">
          Today
        </Link>
      ) : null}
    </div>
  );
}
