import type { PeriodStatus } from "@/lib/payroll/server";

/** Pill colours for a pay period's status. */
export const STATUS_STYLE: Record<PeriodStatus, string> = {
  open: "bg-amber-50 text-amber-800",
  locked: "bg-sky-50 text-sky-800",
  exported: "bg-emerald-50 text-emerald-800",
};
