"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { ensureEditor, recordAudit } from "@/lib/auth/session";
import { sendEmail } from "@/lib/shared/email";
import { textToHtml } from "@/lib/crm/email-templates";
import { NON_MED_CATEGORY, RESCUE_SUBTYPE, RETAIL_LEAD_STATUS_OPTIONS } from "@/lib/crm/types";

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
// Log a visit against a Non-Med Partner record → append to the structured
// activity log (crm_org_visit) and stamp the last-visited / last-contacted
// dates. Mirrors the Rescue CRM's logRescueVisit.
// ---------------------------------------------------------------------------
export async function logPartnerVisit(formData: FormData): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const orgId = str(formData.get("org_id"));
  if (!orgId) return { ok: false, error: "Please choose a partner." };

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

  // Only move the roll-up dates forward — a backdated visit must never lower a
  // more recent last_visit_date / last_contact_date.
  const { data: existing } = await supabase
    .from("crm_organization")
    .select("last_visit_date, last_contact_date")
    .eq("id", orgId)
    .maybeSingle();
  const curVisit = existing?.last_visit_date
    ? String(existing.last_visit_date).slice(0, 10)
    : null;
  const curContact = existing?.last_contact_date
    ? String(existing.last_contact_date).slice(0, 10)
    : null;

  const { error: updErr } = await supabase
    .from("crm_organization")
    .update({
      last_visit_date: !curVisit || visitDate > curVisit ? visitDate : curVisit,
      last_contact_date:
        !curContact || visitDate > curContact ? visitDate : curContact,
    })
    .eq("id", orgId);
  if (updErr) return { ok: false, error: updErr.message };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "partner.visit.log",
    entity: "crm_organization",
    entityId: orgId,
    summary: str(formData.get("spoke_to"))
      ? `Logged visit — spoke with ${str(formData.get("spoke_to"))}`
      : "Logged visit",
  });

  revalidatePath("/crm/vendor");
  revalidatePath(`/crm/org/${orgId}`);
  return { ok: true, message: "Visit logged." };
}

// ---------------------------------------------------------------------------
// Delete a partner record (cascades to its visit log & document attachments).
// ---------------------------------------------------------------------------
export async function deletePartnerOrg(orgId: string): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("crm_organization")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const { error } = await admin.from("crm_organization").delete().eq("id", orgId);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "partner.record.delete",
    entity: "crm_organization",
    entityId: orgId,
    summary: `Deleted partner ${(existing as { name?: string } | null)?.name ?? ""}`.trim(),
  });

  revalidatePath("/crm/vendor");
  revalidatePath("/crm", "layout");
  return { ok: true, message: "Partner deleted." };
}

// ---------------------------------------------------------------------------
// Geocode partner addresses for the Map View (server-side Google Geocoding
// API). Unlike the rescue geocoder this builds the query from the full
// address + city/state/zip, which the partner records mostly have on file.
// ---------------------------------------------------------------------------
const GEOCODE_BATCH = 40;

export type GeocodeResult =
  | { ok: true; geocoded: number; failed: number; remaining: number; message: string }
  | { ok: false; error: string };

type GeocodableOrg = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_address: string | null;
};

/** Full single-line address used as both the geocode query and the cache key. */
function fullAddress(o: GeocodableOrg): string {
  return [o.address, o.city, o.state, o.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export async function geocodePartnerOrgs(): Promise<GeocodeResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return { ok: false, error: gate.error };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY is not configured on the server." };
  }

  const admin = createAdminClient();
  const { data, error } = await fetchAllRows<GeocodableOrg>((from, to) =>
    admin
      .from("crm_organization")
      .select("id, address, city, state, zip, latitude, longitude, geocoded_address")
      .in("org_type", [
        "marketing_partner",
        "facility_resource",
        "med_ops",
        "office_marketing",
      ])
      .eq("category", NON_MED_CATEGORY)
      .or(`subtype.is.null,subtype.neq.${RESCUE_SUBTYPE}`)
      .not("address", "is", null)
      .range(from, to),
  );
  if (error) return { ok: false, error: error.message };

  const stale = (data ?? []).filter((p) => {
    const addr = fullAddress(p);
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
    const address = fullAddress(p);
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
  if (geocoded > 0) {
    revalidatePath("/crm/vendor");
    await recordAudit({
      actorId: gate.current.authId,
      actorEmail: gate.current.email,
      action: "partner.geocode",
      entity: "crm_organization",
      summary: `Geocoded ${geocoded} partner${geocoded === 1 ? "" : "s"}`,
      metadata: { geocoded, failed, remaining },
    });
  }

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
        ? `Geocoded ${geocoded} partner${geocoded === 1 ? "" : "s"}.${failNote} ${remaining} still pending — run again to continue.`
        : `Geocoded ${geocoded} partner${geocoded === 1 ? "" : "s"}.${failNote} Map is up to date.`,
  };
}

// ---------------------------------------------------------------------------
// Retail leads — rows captured by the public /lead/<qr_token> form.
// ---------------------------------------------------------------------------
export async function updateRetailLead(formData: FormData): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const leadId = str(formData.get("lead_id"));
  if (!leadId) return { ok: false, error: "Missing lead." };

  const status = str(formData.get("status"));
  if (status && !RETAIL_LEAD_STATUS_OPTIONS.some((o) => o.value === status)) {
    return { ok: false, error: "Unknown lead status." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_retail_lead")
    .update({
      ...(status ? { status } : {}),
      notes: str(formData.get("notes")),
    })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm/vendor");
  return { ok: true, message: "Lead updated." };
}

export async function deleteRetailLead(leadId: string): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase.from("crm_retail_lead").delete().eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "partner.lead.delete",
    entity: "crm_retail_lead",
    entityId: leadId,
    summary: "Deleted a retail lead",
  });

  revalidatePath("/crm/vendor");
  return { ok: true, message: "Lead deleted." };
}

// ---------------------------------------------------------------------------
// Send a templated email to a Non-Med Partner account (partners@ mailbox).
// ---------------------------------------------------------------------------
export async function sendPartnerEmail(formData: FormData): Promise<ActionResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const orgId = str(formData.get("orgId"));
  const to = str(formData.get("to"));
  const subject = str(formData.get("subject"));
  const body = str(formData.get("body"));
  const templateName = str(formData.get("templateName"));

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: "Enter a valid recipient email address." };
  }
  if (!subject) return { ok: false, error: "Subject is required." };
  if (!body) return { ok: false, error: "Message body is required." };

  const result = await sendEmail({
    to,
    subject,
    text: body,
    html: textToHtml(body),
    tags: [{ name: "type", value: "partner" }],
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Failed to send email." };
  }

  // Record the send as a note (prepended to the org's notes, matching the
  // quick-note format) and stamp last contact.
  if (orgId) {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("crm_organization")
      .select("notes")
      .eq("id", orgId)
      .maybeSingle();

    const stamp = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const entry = `[${stamp}] Email sent to ${to}${templateName ? ` — template “${templateName}”` : ""}: ${subject}`;
    const prevNotes = (existing as { notes: string | null } | null)?.notes?.trim();
    const notes = prevNotes ? `${entry}\n\n${prevNotes}` : entry;
    const today = new Date().toISOString().slice(0, 10);

    await supabase
      .from("crm_organization")
      .update({ notes, last_contact_date: today })
      .eq("id", orgId);
  }

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "partner.email.sent",
    entity: "crm_organization",
    entityId: orgId ?? undefined,
    summary: `Sent email to ${to}${templateName ? ` — “${templateName}”` : ""}: ${subject}`,
    metadata: { to, subject, template: templateName },
  });

  revalidatePath("/crm/vendor");
  if (orgId) revalidatePath(`/crm/org/${orgId}`);
  return { ok: true, message: `Email sent to ${to}.` };
}
