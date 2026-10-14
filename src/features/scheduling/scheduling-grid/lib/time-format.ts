/** Parse an "HH:MM[:SS]" time into minutes since midnight, or null. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * 12-hour clock label with AM/PM ("8:30 AM", "5:00 PM"), matching the format
 * When I Work uses in its shift entry form. Returns "" for missing times.
 */
export function formatClock(t: string | null): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
