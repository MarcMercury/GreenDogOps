import type { MarketingEvent } from "./types";
import { eventTypeLabel, eventStatusLabel } from "./types";

/**
 * CE courses in the Event Management views.
 *
 * A CE course is a company event, but it is BUILT in the CE module (RACE
 * approval, credit hours, CE Broker submission). It is therefore projected
 * here at read time — never copied — so /crm/ce stays the single editor of
 * record and the two lists can never drift.
 */

/** The crm_ce_event columns Event Management needs. */
export interface CeEventSummary {
  id: string;
  name: string;
  event_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  subject: string | null;
  presenters: string | null;
  description: string | null;
  audience: string | null;
  status: string;
  capacity: number | null;
  cost_type: string;
  cost_amount: number | null;
  registration_url: string | null;
  approval_board: string | null;
  approval_status: string | null;
  race_approved: boolean;
  ce_hours_total: number | null;
}

export type EventKind = "marketing" | "ce";

/** The row shape the List and Calendar views render, whatever the source. */
export interface UnifiedEvent {
  kind: EventKind;
  /** Raw row id in its own table. */
  id: string;
  /** Unique across both sources — safe as a React key or calendar event id. */
  key: string;
  name: string;
  /** Marketing event_type, or the synthetic CE type. */
  eventType: string;
  typeLabel: string;
  /** Mapped onto the shared event status palette. */
  status: string;
  statusLabel: string;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  ownerName: string | null;
  cost: number | null;
  attendees: number | null;
  hasPromo: boolean;
  marketing: MarketingEvent | null;
  ce: CeEventSummary | null;
}

export const CE_EVENT_TYPE = "ce_course";

/** CE statuses mapped onto the marketing event palette used by both views. */
const CE_STATUS_MAP: Record<string, string> = {
  planned: "planning",
  scheduled: "confirmed",
  completed: "completed",
  cancelled: "cancelled",
};

export function ceStatusToEventStatus(status: string): string {
  return CE_STATUS_MAP[status] ?? "planning";
}

export function toUnifiedMarketing(e: MarketingEvent): UnifiedEvent {
  return {
    kind: "marketing",
    id: e.id,
    key: `marketing:${e.id}`,
    name: e.name,
    eventType: e.event_type,
    typeLabel: eventTypeLabel(e.event_type),
    status: e.status,
    statusLabel: eventStatusLabel(e.status),
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    location: e.location,
    ownerName: e.owner_name,
    cost: e.cost,
    attendees: e.attendees,
    hasPromo: e.has_promo,
    marketing: e,
    ce: null,
  };
}

export function toUnifiedCe(e: CeEventSummary): UnifiedEvent {
  const status = ceStatusToEventStatus(e.status);
  return {
    kind: "ce",
    id: e.id,
    key: `ce:${e.id}`,
    name: e.name,
    eventType: CE_EVENT_TYPE,
    typeLabel: "CE course",
    status,
    statusLabel: eventStatusLabel(status),
    startsOn: e.event_date,
    endsOn: e.end_date,
    location: e.location,
    // CE courses are owned by the CE program, not an individual event owner.
    ownerName: e.presenters,
    cost: e.cost_type === "paid" ? e.cost_amount : null,
    attendees: null,
    hasPromo: false,
    marketing: null,
    ce: e,
  };
}

/** Both sources as one list, CE courses included only when asked for. */
export function buildUnifiedEvents(
  events: MarketingEvent[],
  ceEvents: CeEventSummary[],
): UnifiedEvent[] {
  return [...events.map(toUnifiedMarketing), ...ceEvents.map(toUnifiedCe)];
}
