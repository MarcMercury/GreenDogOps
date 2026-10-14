import { isIsoDate } from "@/lib/worklist/dates";
import { payPeriodFor, type PayPeriod } from "@/lib/timeclock/pay-period";

/**
 * The pay period the page opens: `?period=` when it is the first day of a pay
 * period, otherwise the newest of the recent ones. A mid-period or malformed
 * value falls back instead of erroring, so a stale link still lands somewhere.
 */
export function selectPayPeriod(periodParam: string | undefined, recent: readonly PayPeriod[]): PayPeriod {
  return periodParam && isIsoDate(periodParam) && payPeriodFor(periodParam).start === periodParam
    ? payPeriodFor(periodParam)
    : recent[0];
}
