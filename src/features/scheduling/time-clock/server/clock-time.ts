import "server-only";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";

/** A punch instant as the clinics' wall-clock time ("3:05 PM"). */
export const clockTime = (iso: string) => formatClockTime(iso, TIME_CLOCK_TZ);
