#!/usr/bin/env node
/**
 * Fill missing phone / address / website and plot map coordinates for EVERY
 * Non-Med Partner record via the Google Places API (v1 searchText).
 *
 *   node scripts/enrich_pet_partners_places.mjs            # dry run, prints a report
 *   node scripts/enrich_pet_partners_places.mjs --apply    # writes to the database
 *   node scripts/enrich_pet_partners_places.mjs --subtype groomer --limit 20
 *
 * Scope is every category='marketing' org except rescues (they have their own
 * CRM). Pass --subtype to narrow it.
 *
 * Why Places and not a scraper: these are physical storefronts, so Places
 * returns an authoritative phone, street address AND lat/lng in a single call —
 * which also plots them on the CRM Map View with no separate geocoding pass.
 *
 * Precision rules (a wrong match is worse than a blank field):
 *   - the result must be in California;
 *   - the business name must match on its distinctive tokens;
 *   - if the record already has a city, the result must be in that city
 *     (or within MAX_CITY_DRIFT_KM of Los Angeles when the city is unknown).
 * Anything that fails is skipped and listed in the report.
 *
 * Existing values are preserved (blank-only fill). The one exception is the
 * fictional "555" exchange seeded into some sample rows — those phones, and the
 * addresses that came with them, are replaced.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env, ROOT } from "./lib/google-auth.mjs";

const APPLY = process.argv.includes("--apply");
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const LIMIT = Number(argOf("--limit") || 0);
const ONLY_SUBTYPE = argOf("--subtype");
/** Re-query records the cache recorded as a miss (after tuning the matcher). */
const RETRY = process.argv.includes("--retry");

const SUBTYPES = ONLY_SUBTYPE ? [ONLY_SUBTYPE] : null; // null = every non-rescue subtype

const CACHE_FILE = path.join(ROOT, ".data", "_pet_partner_places.json");
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.location",
  "places.businessStatus",
  "places.types",
  "places.primaryType",
].join(",");

const LA = { lat: 34.0522, lng: -118.2437 };
const MAX_CITY_DRIFT_KM = 90;
// LA city and neighborhood names overlap constantly (a "Sherman Oaks" shop is
// filed under Van Nuys), so proximity to the stated city beats a name equality
// test — while still rejecting the same-name business down in San Diego.
const MAX_CITY_RADIUS_KM = 25;
const THROTTLE_MS = 120;

/** Extra words appended to the search so Places ranks the right industry first. */
const SUBTYPE_HINT = {
  groomer: "pet grooming",
  pet_retail: "pet store",
  daycare_boarding: "dog daycare boarding",
  pet_business: "pet",
  exotic_shop: "exotic pet store",
  food_vendor: "restaurant",
  chamber: "chamber of commerce",
  local_business: "business",
};

// Subtypes whose records are always animal businesses — only these get the
// "the match must also be a pet business" guard. A chamber of commerce or a
// coffee shop would fail it outright.
const PET_SUBTYPES = new Set([
  "groomer",
  "pet_retail",
  "daycare_boarding",
  "pet_business",
  "exotic_shop",
]);

// Google place types that are unambiguously about animals.
const PET_TYPES = new Set([
  "pet_store",
  "pet_cemetery",
  "veterinary_care",
  "dog_park",
  "animal_shelter",
]);

// Words that make a business name obviously pet-related.
const PET_WORDS = [
  "pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "puppies", "pup",
  "pups", "paw", "paws", "bark", "barks", "fur", "furry", "canine", "feline",
  "kennel", "kennels", "mutt", "mutts", "pooch", "pouch", "wag", "wags",
  "whisker", "whiskers", "hound", "tail", "tails", "leash", "collar",
  "groom", "grooming", "groomer", "groomers", "vet", "animal", "animals",
  "critter", "critters", "woof", "fetch", "kitty", "meow", "purr", "snout",
  "muzzle", "doggie", "doggy", "petco", "petsmart", "aussie", "terrier",
];

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------
// Words that every second pet business shares — they must not be what makes a
// match look convincing.
const STOPWORDS = new Set([
  "the", "and", "of", "for", "a", "an", "at", "inc", "llc", "co", "corp", "ltd",
  "pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "puppies", "animal",
  "animals", "grooming", "groomer", "groomers", "groom", "salon", "spa",
  "boarding", "board", "daycare", "care", "hotel", "resort", "kennel",
  "kennels", "sitting", "sitter", "walking", "walker", "shop", "store",
  "supply", "supplies", "market", "boutique", "company", "services", "service",
  "center", "centre", "club", "house", "place", "room", "studio", "la", "los",
  "angeles", "ca", "california", "mobile", "moblie", "inn", "lodge", "camp",
]);

function normalize(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function coreTokens(s) {
  const all = tokens(s);
  const core = all.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  // A name made entirely of generic words ("Pet Care Center") still has to be
  // comparable, so fall back to the full token list.
  return core.length ? core : all;
}

/** Share of the record's distinctive words that the Places result also has. */
function nameScore(recordName, placeName) {
  const a = coreTokens(recordName);
  const b = new Set(coreTokens(placeName));
  if (!a.length) return 0;
  const hits = a.filter((t) => b.has(t)).length;
  return hits / a.length;
}

function matchedTokenCount(recordName, placeName) {
  const b = new Set(coreTokens(placeName));
  return coreTokens(recordName).filter((t) => b.has(t)).length;
}

/**
 * Distinctive words the Places result adds that the record never had. A real
 * branch only adds a location word; "A Cut Above" → "A Cut Above Butcher Shop"
 * adds a whole different industry.
 */
function strayTokens(row, place) {
  const known = new Set([
    ...coreTokens(row.name),
    ...tokens(row.city ?? ""),
    ...tokens(place.city ?? ""),
    ...tokens(row.state ?? ""),
  ]);
  return coreTokens(place.displayName).filter((t) => t.length >= 4 && !known.has(t));
}

/** Does this look like an animal business at all? */
function isPetBusiness(place) {
  if ((place.types ?? []).some((t) => PET_TYPES.has(t))) return true;
  const words = new Set(tokens(place.displayName));
  return PET_WORDS.some((w) => words.has(w));
}

/**
 * "Dogue Spa" vs "Dogue Spa - The Coolest Dog Grooming Salon": one name is the
 * other plus a descriptor, which is the same business under a longer listing.
 */
function isNamePrefix(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || nb.startsWith(`${na} `) || na.startsWith(`${nb} `);
}

function hasPetWord(name) {
  const words = new Set(tokens(name));
  return PET_WORDS.some((w) => words.has(w));
}

/**
 * Distinctive words the RECORD has that the Places result dropped. "Orange
 * County Veterinary Medical Association" must not match "Orange County Medical
 * Association", nor "Reservoir Dogs of Silver Lake" match "Silver Lake Dog
 * Park". Records that merely tack a descriptor onto the listing's name
 * ("Fancy Tails Company - Dog Walking") are exempted via isNamePrefix.
 */
function missingTokens(row, place) {
  const have = new Set(coreTokens(place.displayName));
  return coreTokens(row.name).filter((t) => t.length >= 4 && !have.has(t));
}

/** Re-checkable guard — also applied to cached matches from earlier runs. */
function matchIsAcceptable(row, match) {
  if (isNamePrefix(row.name, match.displayName)) return true;
  return missingTokens(row, match).length === 0;
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function component(place, type) {
  const c = (place.addressComponents ?? []).find((x) => (x.types ?? []).includes(type));
  return c ? { long: c.longText, short: c.shortText } : null;
}

function parsePlace(place) {
  const streetNumber = component(place, "street_number")?.long ?? "";
  const route = component(place, "route")?.long ?? "";
  const subpremise = component(place, "subpremise")?.long ?? "";
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city =
    component(place, "locality")?.long ??
    component(place, "sublocality_level_1")?.long ??
    component(place, "neighborhood")?.long ??
    null;
  return {
    placeId: place.id,
    displayName: place.displayName?.text ?? "",
    address: street ? (subpremise ? `${street} #${subpremise}` : street) : null,
    formattedAddress: place.formattedAddress ?? null,
    city,
    state: component(place, "administrative_area_level_1")?.short ?? null,
    zip: component(place, "postal_code")?.long ?? null,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ? place.websiteUri.replace(/[?#].*$/, "") : null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    businessStatus: place.businessStatus ?? null,
    types: place.types ?? [],
    primaryType: place.primaryType ?? null,
  };
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
const blank = (v) => v == null || String(v).trim() === "";

/** The 555 exchange is reserved for fiction — these rows were sample data. */
function isFakePhone(v) {
  if (blank(v)) return false;
  const digits = String(v).replace(/\D/g, "").replace(/^1/, "");
  return digits.length === 10 && digits.slice(3, 6) === "555";
}

function cleanWebsite(v) {
  return blank(v) ? null : String(v).trim();
}

// ---------------------------------------------------------------------------
// Places call
// ---------------------------------------------------------------------------
const apiKey = env("GOOGLE_MAPS_API_KEY") || env("GOOGLE_PLACES_API_KEY");

async function searchText(query) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, regionCode: "US", maxResultCount: 5 }),
    });
    if (res.ok) {
      const json = await res.json();
      return (json.places ?? []).map(parsePlace);
    }
    const body = await res.text();
    lastErr = new Error(`Places ${res.status}: ${body.slice(0, 200)}`);
    // 5xx and rate limits are transient; a 4xx will not fix itself.
    if (res.status < 500 && res.status !== 429) throw lastErr;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw lastErr;
}

// Each distinct city is geocoded once and reused for every record in it.
const cityCoords = new Map();
async function coordsForCity(city, state) {
  const key = `${normalize(city)}|${(state || "CA").toUpperCase()}`;
  if (cityCoords.has(key)) return cityCoords.get(key);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${city}, ${state || "CA"}`);
  url.searchParams.set("key", apiKey);
  let coords = null;
  try {
    const json = await (await fetch(url)).json();
    const loc = json.results?.[0]?.geometry?.location;
    if (json.status === "OK" && loc) coords = { lat: loc.lat, lng: loc.lng };
  } catch {
    coords = null;
  }
  cityCoords.set(key, coords);
  return coords;
}

/** Best candidate for a record, or a reason string explaining the rejection. */
function pickMatch(row, candidates, cityPoint) {
  const petScoped = PET_SUBTYPES.has(row.subtype ?? "");
  // Pet records are also screened by isPetBusiness(); everything else has only
  // the name to go on, so it has to match nearly all of the record's words.
  const minScore = petScoped ? 0.6 : 0.8;
  const wantCity = blank(row.city) ? null : normalize(row.city);
  let best = null;
  let bestScore = 0;
  let sawCa = false;
  let sawNonPet = false;
  let sawDropped = false;
  let sawStray = false;
  let sawFar = false;
  for (const c of candidates) {
    if (c.state !== "CA") continue;
    sawCa = true;
    const score = nameScore(row.name, c.displayName);
    if (score < minScore) continue;
    // The record is a pet business, so the match has to be one too — unless
    // neither name says so, in which case only an exact name carries it.
    if (!isPetBusiness(c) && petScoped && (hasPetWord(row.name) || score < 1)) {
      sawNonPet = true;
      continue;
    }
    if (!matchIsAcceptable(row, c)) {
      sawDropped = true;
      continue;
    }
    // A second distinctive word, or no foreign words, keeps single-token
    // matches like "Kingdom" from grabbing an unrelated business.
    const strays = strayTokens(row, c);
    if (
      strays.length &&
      matchedTokenCount(row.name, c.displayName) < 2 &&
      !isNamePrefix(row.name, c.displayName)
    ) {
      sawStray = true;
      continue;
    }
    const here = c.lat != null ? { lat: c.lat, lng: c.lng } : null;
    if (wantCity && normalize(c.city ?? "") !== wantCity) {
      if (!here || !cityPoint || distanceKm(cityPoint, here) > MAX_CITY_RADIUS_KM) {
        sawFar = true;
        continue;
      }
    } else if (!wantCity && here && distanceKm(LA, here) > MAX_CITY_DRIFT_KM) {
      sawFar = true;
      continue;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best) return { match: best, score: bestScore };
  if (!candidates.length) return { reason: "no Places result" };
  if (!sawCa) return { reason: "result outside California" };
  if (sawNonPet) return { reason: "same-name business in another industry" };
  if (sawDropped) return { reason: "result drops a distinctive word from the name" };
  if (sawStray) return { reason: "name match too weak (one shared word)" };
  if (sawFar) return { reason: `match too far from ${row.city || "Los Angeles"}` };
  return { reason: "no confident name match" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!apiKey) {
    console.error("GOOGLE_MAPS_API_KEY is required (.env.local).");
    process.exit(1);
  }
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "greendogops" },
  });

  let query = supabase
    .from("crm_organization")
    .select("id, name, subtype, phone, website, address, city, state, zip, latitude, longitude, geocoded_address")
    .eq("category", "marketing")
    .order("name");
  query = SUBTYPES
    ? query.in("subtype", SUBTYPES)
    : query.or("subtype.is.null,subtype.neq.rescue");
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = data ?? [];
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);
  console.log(`${rows.length} records across ${SUBTYPES ? SUBTYPES.join(", ") : "all Non-Med Partner subtypes"}\n`);

  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const cache = fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
    : {};

  const patches = [];
  const skipped = [];
  const counts = { phone: 0, address: 0, city: 0, state: 0, zip: 0, website: 0, coords: 0, fakePhone: 0 };

  for (const [i, row] of rows.entries()) {
    let result = cache[row.id];
    if (!result || (RETRY && !result.match)) {
      const hint = blank(row.city) ? "Los Angeles, CA" : `${row.city}, ${row.state || "CA"}`;
      const kind = SUBTYPE_HINT[row.subtype] ?? "";
      // The bare name is the most precise query; the category hint is a
      // fallback for names too generic for Places to rank on their own.
      const queries = [`${row.name} ${hint}`];
      if (kind) queries.push(`${row.name} ${kind} ${hint}`);
      try {
        const cityPoint = blank(row.city) ? null : await coordsForCity(row.city, row.state);
        for (const q of queries) {
          const candidates = await searchText(q);
          result = pickMatch(row, candidates, cityPoint);
          await new Promise((r) => setTimeout(r, THROTTLE_MS));
          if (result.match) break;
        }
      } catch (err) {
        console.error(`  ! ${row.name}: ${err.message}`);
        continue;
      }
      cache[row.id] = result;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }

    if (!result.match) {
      skipped.push(`${row.name} [${row.subtype}] — ${result.reason}`);
      continue;
    }
    // Cached matches predate later tightenings of the matcher — re-check.
    if (!matchIsAcceptable(row, result.match)) {
      skipped.push(`${row.name} [${row.subtype}] — result drops a distinctive word from the name`);
      continue;
    }
    const m = result.match;
    const patch = {};
    const fake = isFakePhone(row.phone);
    if (fake) counts.fakePhone += 1;

    if ((blank(row.phone) || fake) && m.phone) {
      patch.phone = m.phone;
      counts.phone += 1;
    }
    // A fictional phone means the whole row was sample data, so its address is
    // replaced too; otherwise addresses are only filled when blank.
    if ((blank(row.address) || fake) && m.address) {
      patch.address = m.address;
      counts.address += 1;
    }
    if ((blank(row.city) || fake) && m.city) {
      patch.city = m.city;
      counts.city += 1;
    }
    if (blank(row.state) && m.state) {
      patch.state = m.state;
      counts.state += 1;
    }
    if ((blank(row.zip) || fake) && m.zip) {
      patch.zip = m.zip;
      counts.zip += 1;
    }
    if (blank(row.website) && m.website) {
      patch.website = cleanWebsite(m.website);
      counts.website += 1;
    }

    // Map coordinates. geocoded_address must equal the app's fullAddress() —
    // [address, city, state, zip] joined — or the Map keeps calling it stale.
    const finalAddress = patch.address ?? row.address;
    const finalCity = patch.city ?? row.city;
    const finalState = patch.state ?? row.state;
    const finalZip = patch.zip ?? row.zip;
    const cacheKey = [finalAddress, finalCity, finalState, finalZip]
      .map((v) => (v ?? "").trim())
      .filter(Boolean)
      .join(", ");
    if (m.lat != null && m.lng != null && cacheKey) {
      patch.latitude = m.lat;
      patch.longitude = m.lng;
      patch.geocoded_at = new Date().toISOString();
      patch.geocoded_address = cacheKey;
      if (row.latitude == null) counts.coords += 1;
    }

    if (Object.keys(patch).length) {
      patches.push({ row, patch, score: result.score });
      const fields = Object.keys(patch).filter((k) => !k.startsWith("geocoded_"));
      console.log(
        `[${i + 1}/${rows.length}] ${row.name} → ${m.displayName}` +
          `${fake ? " (replacing sample data)" : ""}: +${fields.join(", ")}`,
      );
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`matched:        ${patches.length}`);
  console.log(`phones filled:  ${counts.phone} (of which ${counts.fakePhone} replaced fake 555 numbers)`);
  console.log(`addresses:      ${counts.address}  city ${counts.city}  state ${counts.state}  zip ${counts.zip}`);
  console.log(`websites:       ${counts.website}`);
  console.log(`newly mappable: ${counts.coords}`);
  console.log(`skipped:        ${skipped.length}`);
  for (const s of skipped.slice(0, 40)) console.log(`  · ${s}`);
  if (skipped.length > 40) console.log(`  … and ${skipped.length - 40} more`);

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to write these to the database.`);
    return;
  }

  let written = 0;
  for (const { row, patch } of patches) {
    const { error: updErr } = await supabase
      .from("crm_organization")
      .update(patch)
      .eq("id", row.id);
    if (updErr) console.error(`  ! ${row.name}: ${updErr.message}`);
    else written += 1;
  }
  console.log(`\nWrote ${written} records.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
