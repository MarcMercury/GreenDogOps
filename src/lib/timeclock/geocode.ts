import "server-only";

// Google Geocoding for a clinic's stored address (server key; the same API
// the Referral CRM uses). One address per call, with a timeout.

export interface GeocodeHit {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  /** ROOFTOP / RANGE_INTERPOLATED are street-precise; the others are not. */
  precision: string;
  precise: boolean;
}

export type GeocodeResult = { ok: true; hit: GeocodeHit } | { ok: false; error: string };

const TIMEOUT_MS = 8000;

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { ok: false, error: "GOOGLE_MAPS_API_KEY is not configured on the server." };
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", "us");
  url.searchParams.set("key", apiKey);

  let json: {
    status: string;
    error_message?: string;
    results?: {
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number }; location_type?: string };
    }[];
  };
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    json = await res.json();
  } catch (e) {
    return { ok: false, error: `Google Geocoding did not respond (${(e as Error).name}). Try again.` };
  }
  if (json.status === "ZERO_RESULTS") return { ok: false, error: "Google couldn't find that address. Check it under Admin ▸ Locations." };
  if (json.status !== "OK") {
    return { ok: false, error: `Google Geocoding ${json.status}: ${json.error_message ?? "no detail provided"}.` };
  }
  const top = json.results?.[0];
  const loc = top?.geometry?.location;
  if (!loc) return { ok: false, error: "Google returned no coordinates for that address." };
  const precision = top?.geometry?.location_type ?? "UNKNOWN";
  return {
    ok: true,
    hit: {
      latitude: loc.lat,
      longitude: loc.lng,
      formattedAddress: top?.formatted_address ?? address,
      precision,
      precise: precision === "ROOFTOP" || precision === "RANGE_INTERPOLATED",
    },
  };
}
