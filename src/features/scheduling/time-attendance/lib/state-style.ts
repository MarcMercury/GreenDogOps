import type { ShiftState } from "@/lib/timeclock/attendance";

/** Pill colour per time-clock grade. */
export const STATE_STYLE: Record<ShiftState, string> = {
  pto: "bg-sky-50 text-sky-700",
  upcoming: "bg-slate-100 text-slate-500",
  not_in_yet: "bg-amber-50 text-amber-800",
  missed: "bg-red-50 text-red-700",
  working: "bg-emerald-50 text-emerald-700",
  incomplete: "bg-amber-50 text-amber-800",
  left_early: "bg-amber-50 text-amber-800",
  completed: "bg-emerald-50 text-emerald-700",
};
