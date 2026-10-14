import { hours } from "@/lib/payroll/ca-rules";

/** Minutes as decimal hours with two places, the way every payroll figure is shown ("7.50"). */
export function formatHours(minutes: number): string {
  return hours(minutes).toFixed(2);
}
