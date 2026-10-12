// Pure helpers behind the marketing-event notifications.

import { dateRangeLabel } from "../format";

export interface MarketingEventRow {
  id: string;
  name: string | null;
  status: string | null;
  starts_on: string | null;
  ends_on: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  location: string | null;
  clinic_served: string | null;
  parking_info: string | null;
  staff_ids: unknown;
}

export const MARKETING_EVENT_COLUMNS =
  "id, name, status, starts_on, ends_on, arrival_time, departure_time, location, clinic_served, parking_info, staff_ids";

/** Fields whose change is worth telling people about (not results, budget, notes…). */
const TRACKED: { key: keyof MarketingEventRow; label: string }[] = [
  { key: "name", label: "name" },
  { key: "starts_on", label: "date" },
  { key: "ends_on", label: "end date" },
  { key: "arrival_time", label: "arrival time" },
  { key: "departure_time", label: "end time" },
  { key: "location", label: "location" },
  { key: "clinic_served", label: "clinic" },
  { key: "status", label: "status" },
];

const norm = (v: unknown) => (typeof v === "string" ? v.trim() : (v ?? null)) || null;

export function marketingChanges(before: MarketingEventRow, after: MarketingEventRow): string[] {
  return TRACKED.filter((f) => norm(before[f.key]) !== norm(after[f.key])).map((f) => f.label);
}

export function staffIds(row: Pick<MarketingEventRow, "staff_ids"> | null): string[] {
  const v = row?.staff_ids;
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
}

export function newlyAssigned(before: MarketingEventRow | null, after: MarketingEventRow): string[] {
  const had = new Set(staffIds(before));
  return staffIds(after).filter((id) => !had.has(id));
}

export function isCanceled(status: string | null | undefined): boolean {
  return /^cancel+ed$/i.test(status?.trim() ?? "");
}

/** Nobody needs pings about an event that is over. */
export function isInactiveEvent(row: MarketingEventRow, today: string): boolean {
  const status = row.status?.trim().toLowerCase() ?? "";
  if (status === "completed") return true;
  const last = row.ends_on || row.starts_on;
  return !!last && last < today;
}

export function statusLabel(status: string | null): string {
  const s = status?.trim();
  return s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "";
}

export function marketingPayload(row: MarketingEventRow, staffNames: string[]): Record<string, unknown> {
  const time = [row.arrival_time, row.departure_time].map((t) => t?.trim()).filter(Boolean).join(" – ");
  return {
    eventId: row.id,
    name: row.name?.trim() || "Untitled event",
    dates: row.starts_on ? dateRangeLabel(row.starts_on, row.ends_on) : "Date TBD",
    time,
    location: row.location?.trim() ?? "",
    clinic: row.clinic_served?.trim() ?? "",
    status: statusLabel(row.status),
    staffNames,
    arrival: row.arrival_time?.trim() ?? "",
    parking: row.parking_info?.trim() ?? "",
  };
}
