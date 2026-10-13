// Clinic-local wall time ↔ instant — pure, DST-safe, no dependencies.

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at `date` ("YYYY-MM-DD") `time` ("HH:MM") in `timeZone`, or null
 * for malformed input. In the skipped spring-forward hour the result lands an
 * hour later; in the repeated fall-back hour it is the first occurrence.
 */
export function localToInstant(date: string, time: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // The two offsets in force around this wall time (equal except on DST days).
  const candidates = [...new Set([
    wall - offsetMs(new Date(wall - 12 * 3_600_000), timeZone),
    wall - offsetMs(new Date(wall + 12 * 3_600_000), timeZone),
  ])].sort((a, b) => a - b);
  const exact = candidates.filter((c) => c + offsetMs(new Date(c), timeZone) === wall);
  // Repeated hour: the first occurrence. Skipped hour: the later reading.
  return new Date(exact.length > 0 ? exact[0] : candidates[candidates.length - 1]);
}

/** "8:02 AM" in `timeZone`. */
export function formatClockTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

/** "HH:MM" (24h) in `timeZone` — for prefilling a time input. */
export function localHHMM(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
