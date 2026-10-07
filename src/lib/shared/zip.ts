// ---------------------------------------------------------------------------
// US ZIP code helpers. Kept free of server-only imports so the client form
// and unit tests can use them; the network lookup lives in zip-lookup.ts.
// ---------------------------------------------------------------------------

/** The 5-digit US ZIP in `input` ("91335", "91335-1234", " 91335 "), else null. */
export function normalizeUsZip(input: string | null | undefined): string | null {
  const m = String(input ?? "").trim().match(/^(\d{5})(?:[-\s]?\d{4})?$/);
  return m ? m[1] : null;
}

/** "Reseda" + "CA" → "Reseda, CA". */
export function formatCityState(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = city?.trim();
  if (!c) return null;
  const s = state?.trim();
  return s ? `${c}, ${s}` : c;
}

/**
 * Pull "City, ST" out of a zippopotam.us `/us/{zip}` response. A ZIP can span
 * several place names; the first is the USPS default city for that ZIP.
 */
export function cityFromZippopotam(json: unknown): string | null {
  const places = (json as { places?: unknown } | null)?.places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const p = places[0] as Record<string, unknown>;
  const name = typeof p["place name"] === "string" ? p["place name"] : null;
  const state = typeof p["state abbreviation"] === "string" ? p["state abbreviation"] : null;
  return formatCityState(name, state);
}
