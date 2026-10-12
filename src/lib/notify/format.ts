// Small, pure formatting helpers for notification text.

import { shortDateLabel } from "../worklist/dates";

/** "Oct 19" (no weekday) from an ISO date. */
export function monthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** "week of Oct 19". */
export function weekLabel(weekStart: string): string {
  return `week of ${monthDay(weekStart)}`;
}

/** "Thu, Nov 12" or "Thu, Nov 12 – Sat, Nov 14". */
export function dateRangeLabel(start: string, end?: string | null): string {
  if (!end || end === start) return shortDateLabel(start);
  return `${shortDateLabel(start)} – ${shortDateLabel(end)}`;
}

/** Read a string field from an untyped payload. */
export function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** Read a string[] field from an untyped payload. */
export function strList(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Keep a single line short enough for a Slack field / inbox title. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
