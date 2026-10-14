import { shortDateLabel } from "@/lib/worklist/dates";

/** Shown instead of the clinic sections when nothing is published for the day. */
export function NoShiftsNotice({ date }: { date: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      No published shifts on {shortDateLabel(date)}.
    </div>
  );
}
