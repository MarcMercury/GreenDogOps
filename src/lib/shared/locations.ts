// Shared location model — the single source of truth for clinic locations,
// used by the admin Locations directory, scheduling, HR, and CRM modules.

export type LocationKind = "clinic" | "mobile";

export interface Location {
  id: string;
  name: string;
  display_name: string | null;
  code: string | null;
  short_code: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  kind: LocationKind;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  map_url: string | null;
  website_url: string | null;
  notes: string | null;
  parent_location_id: string | null;
}

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  clinic: "Clinic",
  mobile: "Mobile",
};

/** Columns to select for a full location row (keeps queries consistent). */
export const LOCATION_COLUMNS =
  "id, name, display_name, code, short_code, color, sort_order, is_active, kind, " +
  "address_line1, address_line2, city, state, postal_code, phone, email, " +
  "map_url, website_url, notes, parent_location_id";

type AddressParts = Pick<
  Location,
  "address_line1" | "address_line2" | "city" | "state" | "postal_code"
>;

/** Render a one-line address from the structured fields. */
export function formatAddress(l: AddressParts): string {
  const cityState = [l.city, l.state].filter(Boolean).join(", ");
  return [
    l.address_line1,
    l.address_line2,
    [cityState, l.postal_code].filter(Boolean).join(" "),
  ]
    .map((p) => (p ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
}
