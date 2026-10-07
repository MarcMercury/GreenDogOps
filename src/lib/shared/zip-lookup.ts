import "server-only";
import { cityFromZippopotam, normalizeUsZip } from "./zip";

// ZIP → "City, ST" via the free, keyless zippopotam.us API. Results (including
// "not found") are cached in memory for the life of the server instance, so a
// bulk import with many repeat ZIPs only hits the network once per ZIP.

const LOOKUP_TIMEOUT_MS = 4_000;
const cache = new Map<string, string | null>();

export async function lookupCityByZip(input: string | null | undefined): Promise<string | null> {
  const zip = normalizeUsZip(input);
  if (!zip) return null;
  if (cache.has(zip)) return cache.get(zip) ?? null;

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) {
      cache.set(zip, null);
      return null;
    }
    if (!res.ok) return null; // transient — don't cache
    const city = cityFromZippopotam(await res.json());
    cache.set(zip, city);
    return city;
  } catch (err) {
    console.error("[zip] city lookup failed:", err);
    return null;
  }
}

/**
 * The candidate's city to save: the one entered, or — when left blank — the
 * city looked up from their ZIP. Never overwrites a value someone typed.
 */
export async function cityOrZipLookup(
  city: string | null | undefined,
  zip: string | null | undefined,
): Promise<string | null> {
  const c = city?.trim();
  if (c) return c;
  return lookupCityByZip(zip);
}
