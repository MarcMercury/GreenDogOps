import "server-only";
import { isIsoDate } from "@/lib/worklist/dates";
import { payPeriodFor } from "@/lib/timeclock/pay-period";
import { ensurePayPeriod, type PayPeriodRow } from "@/lib/payroll/server";

/**
 * The `pay_period` row for a period, created on first use. Null for anything
 * that is not the first day of a pay period (a malformed or mid-period date),
 * so an action can never approve, lock or reopen the wrong period.
 */
export async function getPayPeriod(periodStart: string): Promise<PayPeriodRow | null> {
  if (!isIsoDate(periodStart)) return null;
  const p = payPeriodFor(periodStart);
  if (p.start !== periodStart) return null;
  return ensurePayPeriod(p);
}
