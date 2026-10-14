import "server-only";
import { formatClockTime } from "@/lib/timeclock/local-time";
import { TIME_CLOCK_TZ } from "@/lib/timeclock/server";

/** A punch instant as clinic-local clock time ("8:03 AM"), or "—" when there is none. */
export const t = (iso: string | null | undefined): string => (iso ? formatClockTime(iso, TIME_CLOCK_TZ) : "—");
