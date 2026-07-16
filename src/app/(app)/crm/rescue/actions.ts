"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { ensureEditor } from "@/lib/auth/session";
import { RESCUE_SUBTYPE } from "@/lib/crm/types";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function arr(formData: FormData, key: string): string[] | null {
  const values = formData
    .getAll(key)
    .map((v) => String(v).trim())
    .filter(Boolean);
  return values.length ? values : null;
}

// ---------------------------------------------------------------------------
// Log a visit against a rescue record → append to the structured activity log
// (crm_org_visit) and stamp the record's last-visited / last-contacted dates.
// ---------------------------------------------------------------------------
export async function logRescueVisit(formData: FormData): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const orgId = str(formData.get("org_id"));
  if (!orgId) return { ok: false, error: "Please choose a rescue." };

  const visitDate =
    str(formData.get("visit_date")) ?? new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("crm_org_visit").insert({
    org_id: orgId,
    user_id: gate.current.authId,
    visit_date: visitDate,
    spoke_to: str(formData.get("spoke_to")),
    visit_notes: str(formData.get("visit_notes")),
    topics: arr(formData, "topics"),
    logged_via: "web",
  });
  if (insErr) return { ok: false, error: insErr.message };

  const { error: updErr } = await supabase
    .from("crm_organization")
    .update({ last_visit_date: visitDate, last_contact_date: visitDate })
    .eq("id", orgId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/crm/rescue");
  revalidatePath(`/crm/org/${orgId}`);
  return { ok: true, message: "Visit logged." };
}

// ---------------------------------------------------------------------------
// Delete a rescue record (cascades to its visit log & document attachments).
// ---------------------------------------------------------------------------
export async function deleteRescue(orgId: string): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const { error } = await admin
    .from("crm_organization")
    .delete()
    .eq("id", orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm/rescue");
  revalidatePath("/crm", "layout");
  return { ok: true, message: "Rescue deleted." };
}

// ---------------------------------------------------------------------------
// Geocode rescue addresses for the Map View (server-side Google Geocoding API).
// Mirrors the Referral CRM's geocodePartners, scoped to rescue records.
// ---------------------------------------------------------------------------
const GEOCODE_BATCH = 40;

export type GeocodeResult =
  | { ok: true; geocoded: number; failed: number; remaining: number; message: string }
  | { ok: false; error: string };

export async function geocodeRescues(): Promise<GeocodeResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return { ok: false, error: gate.error };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY is not configured on the server." };
  }

  const admin = createAdminClient();
  const { data, error } = await fetchAllRows<{
    id: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    geocoded_address: string | null;
  }>((from, to) =>
    admin
      .from("crm_organization")
      .select("id, address, latitude, longitude, geocoded_address")
      .eq("org_type", "marketing_partner")
      .eq("subtype", RESCUE_SUBTYPE)
      .not("address", "is", null)
      .range(from, to),
  );
  if (error) return { ok: false, error: error.message };

  const stale = (data ?? []).filter((p) => {
    const addr = p.address?.trim();
    if (!addr) return false;
    const hasCoords = p.latitude != null && p.longitude != null;
    return !hasCoords || p.geocoded_address !== addr;
  });

  const totalPending = stale.length;
  const batch = stale.slice(0, GEOCODE_BATCH);

  let geocoded = 0;
  let failed = 0;
  const sampleNotFound: string[] = [];

  for (const p of batch) {
    const address = (p.address as string).trim();
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", address);
      url.searchParams.set("key", apiKey);
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as {
        status: string;
        error_message?: string;
        results?: { geometry?: { location?: { lat: number; lng: number } } }[];
      };

      if (
        json.status === "REQUEST_DENIED" ||
        json.status === "OVER_QUERY_LIMIT" ||
        json.status === "INVALID_REQUEST"
      ) {
        return {
          ok: false,
          error: `Google Geocoding API ${json.status}: ${json.error_message ?? "no detail provided"}. Check that the Geocoding API is enabled for GOOGLE_MAPS_API_KEY and that the key has no HTTP-referrer restriction (server-side calls send no referer).`,
        };
      }

      const loc = json.results?.[0]?.geometry?.location;
      if (json.status === "OK" && loc) {
        const { error: updErr } = await admin
          .from("crm_organization")
          .update({
            latitude: loc.lat,
            longitude: loc.lng,
            geocoded_at: new Date().toISOString(),
            geocoded_address: address,
          })
          .eq("id", p.id);
        if (updErr) failed++;
        else geocoded++;
      } else {
        failed++;
        if (sampleNotFound.length < 3) sampleNotFound.push(address);
      }
    } catch {
      failed++;
    }
  }

  const remaining = Math.max(0, totalPending - batch.length);
  if (geocoded > 0) revalidatePath("/crm/rescue");

  const failNote = failed
    ? ` ${failed} address${failed === 1 ? "" : "es"} could not be located${
        sampleNotFound.length ? ` (e.g. "${sampleNotFound[0]}")` : ""
      }.`
    : "";

  return {
    ok: true,
    geocoded,
    failed,
    remaining,
    message:
      remaining > 0
        ? `Geocoded ${geocoded} rescue${geocoded === 1 ? "" : "s"}.${failNote} ${remaining} still pending — run again to continue.`
        : `Geocoded ${geocoded} rescue${geocoded === 1 ? "" : "s"}.${failNote} Map is up to date.`,
  };
}
