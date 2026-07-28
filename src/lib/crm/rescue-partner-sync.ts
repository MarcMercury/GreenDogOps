import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Assimilate ezyVet "Rescue Partners" contacts into the Rescue/Shelter CRM.
 *
 * The ezyVet Contacts export (ingested daily into greendogops.ezyvet_contact)
 * tags some contacts with Customer Group "Rescue Partners". This reconciliation:
 *   1. Loads every rescue-partner contact from ezyvet_contact.
 *   2. Matches each to an existing rescue crm_organization record (by a prior
 *      link, then by name — exact then fuzzy).
 *   3. Where a record exists, fills BLANK fields from the ezyVet contact
 *      (never overwrites curated CRM data) and records the ezyVet link.
 *   4. Where no record exists, creates a new rescue record.
 *
 * Blank-only ("coalesce") assimilation mirrors the vendor-enrichment tooling so
 * a daily run is safe to repeat and never clobbers hand-entered detail.
 */

const RESCUE_PARTNER_GROUP = "rescue partners";

type EzyvetContact = {
  ezyvet_contact_id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  physical_street1: string | null;
  physical_street2: string | null;
  physical_city: string | null;
  physical_state: string | null;
  physical_post_code: string | null;
};

type RescueOrg = {
  id: string;
  name: string;
  ezyvet_contact_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export interface RescuePartnerSyncResult {
  ok: boolean;
  error?: string;
  /** ezyVet rescue-partner contacts considered. */
  contacts: number;
  /** Matched an existing rescue record. */
  matched: number;
  /** Existing records that had at least one blank field filled in. */
  updated: number;
  /** New rescue records created (no match found). */
  created: number;
  details: Array<{
    ezyvet_contact_id: string;
    name: string;
    action: "matched" | "created" | "unchanged";
    org_id: string;
    filled?: string[];
  }>;
}

// Words that carry no identifying weight when comparing rescue names.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "for", "to",
  "dog", "dogs", "cat", "cats", "pet", "pets", "animal", "animals",
  "rescue", "rescues", "shelter", "shelters", "sanctuary", "foundation",
  "project", "friends", "inc", "llc", "org", "co", "society", "humane",
  "adoption", "adoptions", "la", "los", "angeles", "socal", "ca", "california",
]);

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreString(raw: string): string {
  return normalizeName(raw)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t))
    .join("");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity in [0,1] on the identifying "core" of two names. */
function nameSimilarity(a: string, b: string): number {
  const ca = coreString(a);
  const cb = coreString(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const dist = levenshtein(ca, cb);
  return 1 - dist / Math.max(ca.length, cb.length);
}

/** Best rescue record for a contact name, or null if none clears the bar. */
function bestMatch(name: string, orgs: RescueOrg[]): RescueOrg | null {
  const full = normalizeName(name);
  let best: RescueOrg | null = null;
  let bestScore = 0;
  for (const org of orgs) {
    // Exact normalized name is an unambiguous match.
    if (normalizeName(org.name) === full && full.length >= 3) return org;
    const score = nameSimilarity(name, org.name);
    if (score > bestScore) {
      bestScore = score;
      best = org;
    }
  }
  // High fuzzy bar avoids merging genuinely different rescues; the core must be
  // long enough that a near-match is meaningful (guards tiny generic cores).
  if (best && bestScore >= 0.86 && coreString(name).length >= 4) return best;
  return null;
}

function firstEmail(raw: string | null): string | null {
  if (!raw) return null;
  const token = raw.split(/[\s,;]+/).find((t) => t.includes("@"));
  return token ? token.trim().toLowerCase() : null;
}

function firstPhone(...raws: (string | null)[]): string | null {
  for (const raw of raws) {
    if (!raw) continue;
    const m = raw.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (m) return m[0].trim();
  }
  return null;
}

const STATE_ABBR: Record<string, string> = {
  california: "CA", nevada: "NV", arizona: "AZ", oregon: "OR", washington: "WA",
  texas: "TX", utah: "UT", colorado: "CO", "new york": "NY", florida: "FL",
};

function normalizeState(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] ?? s;
}

function contactName(c: EzyvetContact): string | null {
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  // Prefer a person's name; skip when it merely echoes the business name.
  if (person && person.toLowerCase() !== (c.business_name ?? "").toLowerCase()) {
    return person;
  }
  return null;
}

function rescueName(c: EzyvetContact): string {
  return (
    (c.business_name && c.business_name.trim()) ||
    (c.full_name && c.full_name.trim()) ||
    "Unknown rescue"
  );
}

/** Build the coalesce patch of blank org fields fillable from a contact. */
function assimilationPatch(
  org: RescueOrg,
  c: EzyvetContact,
): { patch: Record<string, unknown>; filled: string[] } {
  const patch: Record<string, unknown> = {};
  const filled: string[] = [];
  const fill = (field: keyof RescueOrg, value: string | null) => {
    if (value && !org[field]) {
      patch[field] = value;
      filled.push(field);
    }
  };

  fill("contact_name", contactName(c));
  fill("email", firstEmail(c.email));
  fill("phone", firstPhone(c.phone, c.mobile));
  fill(
    "address",
    [c.physical_street1, c.physical_street2].filter(Boolean).join(", ") || null,
  );
  fill("city", c.physical_city?.trim() || null);
  fill("state", normalizeState(c.physical_state));
  fill("zip", c.physical_post_code?.trim() || null);
  fill("website", c.website?.trim() || null);

  // Always establish the link the first time we see it (provenance + idempotency).
  if (!org.ezyvet_contact_id) {
    patch.ezyvet_contact_id = c.ezyvet_contact_id;
  }
  return { patch, filled };
}

export async function syncRescuePartnersFromEzyvet(): Promise<RescuePartnerSyncResult> {
  const admin = createAdminClient();
  const result: RescuePartnerSyncResult = {
    ok: true,
    contacts: 0,
    matched: 0,
    updated: 0,
    created: 0,
    details: [],
  };

  const { data: contactRows, error: contactErr } = await admin
    .from("ezyvet_contact")
    .select(
      "ezyvet_contact_id, business_name, first_name, last_name, full_name, email, phone, mobile, website, physical_street1, physical_street2, physical_city, physical_state, physical_post_code, customer_group",
    )
    .ilike("customer_group", RESCUE_PARTNER_GROUP);
  if (contactErr) {
    return { ...result, ok: false, error: contactErr.message };
  }
  const contacts = (contactRows ?? []) as EzyvetContact[];
  result.contacts = contacts.length;
  if (contacts.length === 0) return result;

  const { data: orgRows, error: orgErr } = await admin
    .from("crm_organization")
    .select(
      "id, name, ezyvet_contact_id, contact_name, email, phone, website, address, city, state, zip",
    )
    .eq("org_type", "marketing_partner")
    .eq("subtype", "rescue");
  if (orgErr) {
    return { ...result, ok: false, error: orgErr.message };
  }
  const orgs = (orgRows ?? []) as RescueOrg[];

  // Stable order so re-runs behave deterministically and the first contact for a
  // given rescue "owns" the link when several ezyVet variants map to one record.
  const sorted = [...contacts].sort((a, b) =>
    a.ezyvet_contact_id.localeCompare(b.ezyvet_contact_id),
  );
  const claimedThisRun = new Set<string>();
  const createdByCore = new Map<string, RescueOrg>();

  for (const c of sorted) {
    const name = rescueName(c);

    let target: RescueOrg | null =
      orgs.find((o) => o.ezyvet_contact_id === c.ezyvet_contact_id) ?? null;
    if (!target) target = bestMatch(name, orgs);
    if (!target) {
      const core = coreString(name);
      if (core) target = createdByCore.get(core) ?? null;
    }

    if (target) {
      const { patch, filled } = assimilationPatch(target, c);
      // Don't overwrite a link already claimed by another ezyVet contact.
      if (target.ezyvet_contact_id && claimedThisRun.has(target.id)) {
        delete patch.ezyvet_contact_id;
      }
      result.matched++;
      if (Object.keys(patch).length > 0) {
        const { error } = await admin
          .from("crm_organization")
          .update(patch)
          .eq("id", target.id);
        if (error) return { ...result, ok: false, error: error.message };
        Object.assign(target, patch); // keep in-memory view fresh for later contacts
        if (filled.length > 0) result.updated++;
      }
      claimedThisRun.add(target.id);
      result.details.push({
        ezyvet_contact_id: c.ezyvet_contact_id,
        name: target.name,
        action: filled.length > 0 ? "matched" : "unchanged",
        org_id: target.id,
        filled: filled.length ? filled : undefined,
      });
      continue;
    }

    // No match anywhere → create a new rescue record from the ezyVet contact.
    const insert = {
      org_type: "marketing_partner",
      subtype: "rescue",
      category: "marketing",
      status: "active",
      name,
      contact_name: contactName(c),
      email: firstEmail(c.email),
      phone: firstPhone(c.phone, c.mobile),
      website: c.website?.trim() || null,
      address:
        [c.physical_street1, c.physical_street2].filter(Boolean).join(", ") ||
        null,
      city: c.physical_city?.trim() || null,
      state: normalizeState(c.physical_state),
      zip: c.physical_post_code?.trim() || null,
      ezyvet_contact_id: c.ezyvet_contact_id,
      source: "ezyvet_rescue_partner",
      notes: `Imported from ezyVet "Rescue Partners" contact ${c.ezyvet_contact_id} on ${new Date().toISOString().slice(0, 10)}.`,
    };
    const { data: inserted, error } = await admin
      .from("crm_organization")
      .insert(insert)
      .select(
        "id, name, ezyvet_contact_id, contact_name, email, phone, website, address, city, state, zip",
      )
      .single();
    if (error) return { ...result, ok: false, error: error.message };
    const newOrg = inserted as RescueOrg;
    orgs.push(newOrg);
    const core = coreString(name);
    if (core) createdByCore.set(core, newOrg);
    claimedThisRun.add(newOrg.id);
    result.created++;
    result.details.push({
      ezyvet_contact_id: c.ezyvet_contact_id,
      name: newOrg.name,
      action: "created",
      org_id: newOrg.id,
    });
  }

  return result;
}
