"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows, mapWithConcurrency } from "@/lib/supabase/paginate";
import { requireUser, requireAdmin, recordAudit } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------
function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}
function arr(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((v) => String(v)).filter(Boolean);
}

// Every action in this file mutates referral data, so it requires *edit*
// rights on the Referral CRM (Owner/Admin/Manager-HR). Staff and Schedule
// Admins are read-only and get redirected away.
async function requireReferralUser() {
  const current = await requireUser();
  if (!canEditModule(current.appUser, "crm_referral")) redirect("/");
  return current;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Create / update a partner
// ---------------------------------------------------------------------------
export async function savePartner(formData: FormData): Promise<ActionResult> {
  const current = await requireReferralUser();
  const supabase = await createClient();

  const id = str(formData.get("id"));
  const partnerName = str(formData.get("name")) ?? "Unnamed Partner";
  const patch: Record<string, unknown> = {
    name: partnerName,
    // Legacy NOT-NULL column mirrored from public.referral_partners; keep it in
    // sync with name so inserts never violate its not-null constraint.
    hospital_name: partnerName,
    status: str(formData.get("status")) ?? "active",
    contact_name: str(formData.get("contact_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    address: str(formData.get("address")),
    website: str(formData.get("website")),
    instagram_handle: str(formData.get("instagram_handle")),
    facebook_url: str(formData.get("facebook_url")),
    linkedin_url: str(formData.get("linkedin_url")),
    notes: str(formData.get("notes")),
    // Classification
    tier: str(formData.get("tier")),
    priority: str(formData.get("priority")),
    zone: str(formData.get("zone")),
    clinic_type: str(formData.get("clinic_type")),
    size: str(formData.get("size")),
    organization_type: str(formData.get("organization_type")),
    employee_count: str(formData.get("employee_count")),
    services: arr(formData, "services"),
    // Visit schedule
    visit_frequency: str(formData.get("visit_frequency")),
    expected_visit_frequency_days: num(formData.get("expected_visit_frequency_days")),
    preferred_visit_day: str(formData.get("preferred_visit_day")),
    preferred_visit_time: str(formData.get("preferred_visit_time")),
    best_contact_person: str(formData.get("best_contact_person")),
    next_followup_date: str(formData.get("next_followup_date")),
    needs_followup: bool(formData.get("needs_followup")),
    // Agreements
    referral_agreement_type: str(formData.get("referral_agreement_type")),
    ce_event_host: bool(formData.get("ce_event_host")),
    lunch_and_learn_eligible: bool(formData.get("lunch_and_learn_eligible")),
    drop_off_materials: bool(formData.get("drop_off_materials")),
    // Stats (manual overrides)
    total_referrals_all_time: num(formData.get("total_referrals_all_time")),
    total_revenue_all_time: num(formData.get("total_revenue_all_time")),
    updated_at: new Date().toISOString(),
  };

  // Drop null stat overrides so we never wipe ledger-derived values by accident
  if (patch.total_referrals_all_time == null) delete patch.total_referrals_all_time;
  if (patch.total_revenue_all_time == null) delete patch.total_revenue_all_time;

  if (id) {
    const { error } = await supabase.from("referral_partners").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: current.authId, actorEmail: current.email,
      action: "referral.partner.update", entity: "referral_partner", entityId: id,
      summary: `Updated partner ${patch.name}`,
    });
  } else {
    const { data, error } = await supabase.from("referral_partners").insert(patch).select("id").single();
    if (error) return { ok: false, error: error.message };
    await recordAudit({
      actorId: current.authId, actorEmail: current.email,
      action: "referral.partner.create", entity: "referral_partner", entityId: data?.id,
      summary: `Created partner ${patch.name}`,
    });
  }

  revalidatePath("/crm/referral");
  return { ok: true, message: "Partner saved." };
}

// ---------------------------------------------------------------------------
// Delete a partner (and its visit logs)
// ---------------------------------------------------------------------------
export async function deletePartner(id: string): Promise<ActionResult> {
  const current = await requireReferralUser();
  const supabase = await createClient();
  await supabase.from("clinic_visits").delete().eq("partner_id", id);
  const { error } = await supabase.from("referral_partners").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.partner.delete", entity: "referral_partner", entityId: id,
    summary: "Deleted referral partner",
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: "Partner deleted." };
}

// ---------------------------------------------------------------------------
// Quick visit logging -> clinic_visits + update partner last_visit_date
// ---------------------------------------------------------------------------
export async function logQuickVisit(formData: FormData): Promise<ActionResult> {
  const current = await requireReferralUser();
  const supabase = await createClient();

  const partnerId = str(formData.get("partner_id"));
  const clinicName = str(formData.get("clinic_name"));
  if (!clinicName) return { ok: false, error: "Clinic name is required." };

  const visitDate = str(formData.get("visit_date")) ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("clinic_visits").insert({
    user_id: current.authId,
    partner_id: partnerId,
    clinic_name: clinicName,
    visit_date: visitDate,
    spoke_to: str(formData.get("spoke_to")),
    items_discussed: arr(formData, "items_discussed"),
    next_visit_date: str(formData.get("next_visit_date")),
    visit_notes: str(formData.get("visit_notes")),
    logged_via: "web",
  });
  if (error) return { ok: false, error: error.message };

  if (partnerId) {
    await supabase
      .from("referral_partners")
      .update({
        last_visit_date: visitDate,
        last_contact_date: visitDate,
        needs_followup: false,
        next_followup_date: str(formData.get("next_visit_date")),
        updated_at: new Date().toISOString(),
      })
      .eq("id", partnerId);

    // Refresh derived metrics (days-since-visit, overdue flag, relationship
    // health/status) immediately so the new visit is reflected without
    // waiting for a manual "Recalculate Metrics".
    await createAdminClient().rpc("recalculate_partner_metrics");
  }

  revalidatePath("/crm/referral");
  return { ok: true, message: "Visit logged." };
}

// ---------------------------------------------------------------------------
// Quick-add an unmatched upload clinic as a new partner
// Creates the partner, re-links any orphaned revenue line items that carry the
// same CSV clinic name, merges their divisions, then recalculates metrics so
// the previously-unmatched revenue/referrals fold into the new partner.
// ---------------------------------------------------------------------------
export async function addUnmatchedPartner(formData: FormData): Promise<ActionResult> {
  const current = await requireReferralUser();
  const clinicName = str(formData.get("clinic_name"));
  if (!clinicName) return { ok: false, error: "Clinic name is required." };
  const admin = createAdminClient();

  // Guard against creating a duplicate of an existing partner.
  const { data: existing } = await admin
    .from("referral_partners")
    .select("id, name")
    .ilike("name", clinicName)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: `A partner named "${existing.name}" already exists.` };
  }

  // 1. Create the partner.
  const now = new Date().toISOString();
  const { data: partner, error: insErr } = await admin
    .from("referral_partners")
    .insert({
      name: clinicName,
      // Legacy NOT-NULL column mirrored from public.referral_partners.
      hospital_name: clinicName,
      status: "active",
      last_data_source: "csv_upload",
      last_sync_date: now,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insErr || !partner) return { ok: false, error: insErr?.message ?? "Failed to create partner." };

  // 2. Re-link orphaned revenue line items recorded under this clinic name.
  const { data: relinked, error: relinkErr } = await admin
    .from("referral_revenue_line_items")
    .update({ partner_id: partner.id })
    .is("partner_id", null)
    .eq("csv_clinic_name", clinicName)
    .select("division");
  if (relinkErr) return { ok: false, error: relinkErr.message };
  const linkedCount = relinked?.length ?? 0;

  // 3. Merge divisions discovered on those line items onto the partner.
  const divisions = [
    ...new Set((relinked ?? []).map((r) => r.division as string | null).filter((d): d is string => !!d)),
  ].sort();
  if (divisions.length) {
    await admin.from("referral_partners").update({ referral_divisions: divisions }).eq("id", partner.id);
  }

  // 4. Recompute totals + tier / priority / health for everyone.
  await admin.rpc("recalculate_partner_metrics");

  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.partner.quickadd", entity: "referral_partner", entityId: partner.id,
    summary: `Quick-added partner ${clinicName} from unmatched upload`,
    metadata: { lineItemsRelinked: linkedCount, divisions },
  });

  revalidatePath("/crm/referral");
  return {
    ok: true,
    message: linkedCount
      ? `Added "${clinicName}" — ${linkedCount.toLocaleString()} referral${linkedCount === 1 ? "" : "s"} linked.`
      : `Added "${clinicName}".`,
  };
}

// ---------------------------------------------------------------------------
// Dismiss an unmatched clinic from the Match list ("Delete").
// Removes the orphaned revenue line items recorded under this CSV clinic name
// WITHOUT creating a partner. Because these rows carry no partner_id they never
// contributed to any profile total, so no recalculation is needed.
// ---------------------------------------------------------------------------
export async function dismissUnmatched(clinicName: string): Promise<ActionResult> {
  const current = await requireReferralUser();
  if (!clinicName) return { ok: false, error: "Clinic name is required." };
  const admin = createAdminClient();

  const { data: removed, error } = await admin
    .from("referral_revenue_line_items")
    .delete()
    .is("partner_id", null)
    .eq("csv_clinic_name", clinicName)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = removed?.length ?? 0;

  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.unmatched.dismiss",
    summary: `Dismissed unmatched clinic ${clinicName}`,
    metadata: { lineItemsRemoved: count },
  });

  revalidatePath("/crm/referral");
  return {
    ok: true,
    message: `Removed "${clinicName}" from the match list${count ? ` (${count.toLocaleString()} row${count === 1 ? "" : "s"} deleted)` : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// Partner contacts CRUD
// ---------------------------------------------------------------------------
export async function saveContact(formData: FormData): Promise<ActionResult> {
  const current = await requireReferralUser();
  const supabase = await createClient();

  const id = str(formData.get("id"));
  const partnerId = str(formData.get("partner_id"));
  if (!partnerId) return { ok: false, error: "Partner is required." };
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "Contact name is required." };

  const patch: Record<string, unknown> = {
    partner_id: partnerId,
    name,
    title: str(formData.get("title")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    is_primary: bool(formData.get("is_primary")),
    preferred_contact_method: str(formData.get("preferred_contact_method")),
    relationship_notes: str(formData.get("relationship_notes")),
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("partner_contacts").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("partner_contacts").insert(patch);
    if (error) return { ok: false, error: error.message };
  }
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: id ? "referral.contact.update" : "referral.contact.create",
    entity: "referral_partner", entityId: partnerId,
    summary: `${id ? "Updated" : "Added"} contact ${name}`,
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: "Contact saved." };
}

export async function deleteContact(id: string): Promise<ActionResult> {
  await requireReferralUser();
  const supabase = await createClient();
  const { error } = await supabase.from("partner_contacts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/referral");
  return { ok: true, message: "Contact deleted." };
}

// ---------------------------------------------------------------------------
// Partner notes CRUD
// ---------------------------------------------------------------------------
export async function saveNote(formData: FormData): Promise<ActionResult> {
  const current = await requireReferralUser();
  const supabase = await createClient();

  const id = str(formData.get("id"));
  const partnerId = str(formData.get("partner_id"));
  if (!partnerId) return { ok: false, error: "Partner is required." };
  const content = str(formData.get("content"));
  if (!content) return { ok: false, error: "Note content is required." };

  const authorName = current.appUser.full_name || current.email || "Unknown";
  const initials = authorName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const patch: Record<string, unknown> = {
    partner_id: partnerId,
    category: str(formData.get("category")) ?? "general",
    note_type: str(formData.get("category")) ?? "general",
    content,
    is_pinned: bool(formData.get("is_pinned")),
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("partner_notes").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("partner_notes").insert({
      ...patch,
      created_by: current.authId,
      created_by_name: authorName,
      author_initials: initials,
    });
    if (error) return { ok: false, error: error.message };
  }
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: id ? "referral.note.update" : "referral.note.create",
    entity: "referral_partner", entityId: partnerId,
    summary: `${id ? "Updated" : "Added"} note`,
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: "Note saved." };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  await requireReferralUser();
  const supabase = await createClient();
  const { error } = await supabase.from("partner_notes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/referral");
  return { ok: true, message: "Note deleted." };
}

// ---------------------------------------------------------------------------
// Recalculate metrics (tier / priority / visit-tier / health) for all partners
// ---------------------------------------------------------------------------
export async function recalculateMetrics(): Promise<ActionResult> {
  const current = await requireReferralUser();
  const admin = createAdminClient();
  const { error } = await admin.rpc("recalculate_partner_metrics");
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.metrics.recalculate", summary: "Recalculated partner metrics",
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: "Partner metrics recalculated." };
}

// ---------------------------------------------------------------------------
// Geocode partners for the Map View
// ---------------------------------------------------------------------------
// Resolves lat/lng from each partner's `address` via the Google Geocoding API
// and caches the result on the row. Only partners that have an address but are
// missing coordinates (or whose address changed since the last geocode) are
// processed. Capped per-call so the server action stays well under platform
// timeouts; the UI can re-run until `remaining` hits 0.
export type GeocodeResult =
  | { ok: true; geocoded: number; failed: number; remaining: number; message: string }
  | { ok: false; error: string };

const GEOCODE_BATCH = 40;

export async function geocodePartners(): Promise<GeocodeResult> {
  await requireReferralUser();

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY is not configured on the server." };
  }

  const admin = createAdminClient();
  const { data, error } = await fetchAllRows<{
    id: unknown;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    geocoded_address: string | null;
  }>((from, to) =>
    admin
      .from("referral_partners")
      .select("id, address, latitude, longitude, geocoded_address")
      .not("address", "is", null)
      .range(from, to),
  );
  if (error) return { ok: false, error: error.message };

  const stale = (data ?? []).filter((p) => {
    const addr = (p.address as string | null)?.trim();
    if (!addr) return false;
    const hasCoords = p.latitude != null && p.longitude != null;
    return !hasCoords || p.geocoded_address !== addr;
  });

  const totalPending = stale.length;
  const batch = stale.slice(0, GEOCODE_BATCH);

  let geocoded = 0;
  let failed = 0;
  // Reasons we couldn't locate addresses (e.g. ZERO_RESULTS), for diagnostics.
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

      // A bad API key / disabled API / billing problem fails identically for
      // EVERY address. Abort the whole run immediately and surface Google's own
      // error_message so it's actionable instead of "0 geocoded".
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
          .from("referral_partners")
          .update({
            latitude: loc.lat,
            longitude: loc.lng,
            geocoded_at: new Date().toISOString(),
            geocoded_address: address,
          })
          .eq("id", p.id as string);
        if (updErr) failed++;
        else geocoded++;
      } else {
        // ZERO_RESULTS or similar — this specific address couldn't be located.
        failed++;
        if (sampleNotFound.length < 3) sampleNotFound.push(address);
      }
    } catch {
      failed++;
    }
  }

  const remaining = Math.max(0, totalPending - batch.length);
  if (geocoded > 0) revalidatePath("/crm/referral");

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
        ? `Geocoded ${geocoded} clinic${geocoded === 1 ? "" : "s"}.${failNote} ${remaining} still pending — run again to continue.`
        : `Geocoded ${geocoded} clinic${geocoded === 1 ? "" : "s"}.${failNote} Map is up to date.`,
  };
}

// ---------------------------------------------------------------------------
// Persist client-resolved coordinates for the Map View
// ---------------------------------------------------------------------------
// The browser geocodes addresses with the referrer-restricted public Maps key
// (the Google Geocoding *web service* rejects referrer-restricted keys, but the
// in-browser Geocoder accepts them). This action just stores the results.
export type SaveCoordsInput = {
  id: string;
  lat: number;
  lng: number;
  address: string;
};

export async function savePartnerCoords(
  updates: SaveCoordsInput[],
): Promise<ActionResult> {
  await requireReferralUser();
  if (!Array.isArray(updates) || updates.length === 0) {
    return { ok: true, message: "Nothing to save." };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  let saved = 0;

  for (const u of updates) {
    if (
      !u?.id ||
      typeof u.lat !== "number" ||
      typeof u.lng !== "number" ||
      !Number.isFinite(u.lat) ||
      !Number.isFinite(u.lng)
    ) {
      continue;
    }
    const { error } = await admin
      .from("referral_partners")
      .update({
        latitude: u.lat,
        longitude: u.lng,
        geocoded_at: now,
        geocoded_address: (u.address ?? "").trim() || null,
      })
      .eq("id", u.id);
    if (!error) saved++;
  }

  if (saved > 0) revalidatePath("/crm/referral");
  return { ok: true, message: `Saved ${saved} location${saved === 1 ? "" : "s"}.` };
}

// ---------------------------------------------------------------------------
// Clear all referral stats (destructive — admin only)
// ---------------------------------------------------------------------------
export async function clearReferralStats(): Promise<ActionResult> {
  const current = await requireAdmin();
  const admin = createAdminClient();

  const { error: delErr } = await admin
    .from("referral_revenue_line_items")
    .delete()
    .not("id", "is", null);
  if (delErr) return { ok: false, error: delErr.message };

  const { error: updErr } = await admin
    .from("referral_partners")
    .update({
      total_referrals_all_time: 0,
      total_revenue_all_time: 0,
      referrals_last_12_months: 0,
      last_referral_date: null,
      last_sync_date: null,
      last_data_source: null,
      updated_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (updErr) return { ok: false, error: updErr.message };

  await admin.rpc("recalculate_partner_metrics");
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.stats.clear", summary: "Cleared all referral stats",
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: "All referral stats cleared." };
}

// ===========================================================================
// Date-range referral report
// ===========================================================================
export interface ReferralReportClinic {
  partnerId: string | null;
  name: string;
  matched: boolean;
  revenue: number;
  referrals: number;
}
export interface ReferralReport {
  start: string;
  end: string;
  totalRevenue: number;
  totalReferrals: number;
  matchedRevenue: number;
  unmatchedRevenue: number;
  uniqueClinics: number;
  topClinics: ReferralReportClinic[];
  byDivision: { division: string; revenue: number; referrals: number }[];
  monthly: { month: string; revenue: number; referrals: number }[];
}
export type ReferralReportResult =
  | { ok: true; report: ReferralReport }
  | { ok: false; error: string };

/**
 * Aggregate revenue line items whose `transaction_date` falls within
 * [start, end] (inclusive, YYYY-MM-DD). Returns totals, top clinics by
 * revenue, a per-division breakdown, and a monthly time series. Read-only —
 * available to any user who can view the Referral CRM.
 */
export async function getReferralReport(start: string, end: string): Promise<ReferralReportResult> {
  await requireUser();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start) || !iso.test(end)) return { ok: false, error: "Invalid date range." };
  if (start > end) return { ok: false, error: "Start date must be on or before end date." };

  const supabase = await createClient();

  const { data: rows, error } = await fetchAllRows<{
    partner_id: string | null;
    csv_clinic_name: string | null;
    amount: number | null;
    division: string | null;
    transaction_date: string | null;
  }>((from, to) =>
    supabase
      .from("referral_revenue_line_items")
      .select("partner_id, csv_clinic_name, amount, division, transaction_date")
      .gte("transaction_date", start)
      .lte("transaction_date", end)
      .range(from, to),
  );
  if (error) return { ok: false, error: error.message };

  // Map partner ids to display names.
  const { data: partnerRows } = await supabase.from("referral_partners").select("id, name");
  const partnerNames = new Map<string, string>((partnerRows ?? []).map((p) => [p.id as string, (p.name as string) ?? "Unnamed"]));

  const clinics = new Map<string, ReferralReportClinic>();
  const divisions = new Map<string, { revenue: number; referrals: number }>();
  const months = new Map<string, { revenue: number; referrals: number }>();
  let totalRevenue = 0;
  let matchedRevenue = 0;

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    totalRevenue += amount;

    const key = r.partner_id ?? `csv:${(r.csv_clinic_name ?? "").toLowerCase()}`;
    const existing = clinics.get(key);
    if (existing) {
      existing.revenue += amount;
      existing.referrals += 1;
    } else {
      clinics.set(key, {
        partnerId: r.partner_id ?? null,
        name: r.partner_id ? partnerNames.get(r.partner_id) ?? r.csv_clinic_name ?? "Unnamed" : r.csv_clinic_name ?? "Unmatched",
        matched: Boolean(r.partner_id),
        revenue: amount,
        referrals: 1,
      });
    }
    if (r.partner_id) matchedRevenue += amount;

    const div = r.division?.trim() || "Uncategorized";
    const d = divisions.get(div) ?? { revenue: 0, referrals: 0 };
    d.revenue += amount;
    d.referrals += 1;
    divisions.set(div, d);

    const month = (r.transaction_date ?? "").slice(0, 7); // YYYY-MM
    if (iso.test(r.transaction_date ?? "")) {
      const m = months.get(month) ?? { revenue: 0, referrals: 0 };
      m.revenue += amount;
      m.referrals += 1;
      months.set(month, m);
    }
  }

  const clinicList = [...clinics.values()];
  const report: ReferralReport = {
    start,
    end,
    totalRevenue,
    totalReferrals: rows.length,
    matchedRevenue,
    unmatchedRevenue: totalRevenue - matchedRevenue,
    uniqueClinics: clinicList.length,
    topClinics: clinicList.sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    byDivision: [...divisions.entries()]
      .map(([division, v]) => ({ division, ...v }))
      .sort((a, b) => b.revenue - a.revenue),
    monthly: [...months.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
  return { ok: true, report };
}

// ---------------------------------------------------------------------------
// Undo a single upload (admin only)
// ---------------------------------------------------------------------------
export async function undoReferralUpload(uploadId: string): Promise<ActionResult> {
  const current = await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("undo_referral_upload", { p_upload_id: uploadId });
  if (error) return { ok: false, error: error.message };
  const deleted = Array.isArray(data) ? data[0]?.rows_deleted ?? 0 : 0;
  await admin.rpc("recalculate_partner_metrics");
  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.upload.undo", entityId: uploadId,
    summary: `Undid upload (${deleted} rows removed)`,
  });
  revalidatePath("/crm/referral");
  return { ok: true, message: `Upload undone — ${deleted} rows removed.` };
}

// ===========================================================================
// EzyVet report upload parser (port of server/api/parse-referrals.post.ts)
// ===========================================================================
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
type ReportType = "revenue" | "statistics";

interface ParsedRevenueEntry {
  clinicName: string; referringVet: string; clientName: string;
  animalName: string; amount: number; date: string; division: string;
}
interface ParsedStatisticsEntry {
  clinicName: string; lastReferralDate: string | null; totalReferrals12Months: number;
}

export interface UploadResult {
  success: boolean;
  reportType?: ReportType;
  uploadId?: string;
  message: string;
  updated?: number;
  skipped?: number;
  notMatched?: number;
  revenueAdded?: number;
  visitorsAdded?: number;
  newRows?: number | null;
  totalRows?: number | null;
  invalidDateRows?: number;
  dateRange?: { start: string; end: string } | null;
  overlapWarning?: string | null;
  isDuplicateUpload?: boolean;
  details?: Array<{
    clinicName: string; matched: boolean; matchedTo?: string;
    visits: number; revenue: number; lastVisitDate?: string; divisions?: string[];
  }>;
  error?: string;
}

function detectReportType(csvText: string): ReportType {
  const firstLine = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")[0].toLowerCase();
  if (firstLine.includes("clinic name") && firstLine.includes("date of last referral")) return "statistics";
  if (firstLine.includes("date/time") && firstLine.includes("referring vet clinic")) return "revenue";
  return "revenue";
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else current += char;
  }
  fields.push(current.trim());
  return fields;
}

function parseRevenueCSV(csvText: string): ParsedRevenueEntry[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: ParsedRevenueEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 7) continue;
    const dateTime = fields[0].trim();
    const clinicName = fields[1].trim();
    if (!dateTime || !clinicName) continue;
    if (clinicName.toLowerCase() === "unknown clinic") continue;
    if (clinicName.toLowerCase().startsWith("total")) continue;
    const amount = parseFloat(fields[6].trim().replace(/[,$]/g, "")) || 0;
    if (amount <= 0) continue;
    entries.push({
      clinicName, referringVet: fields[2]?.trim() || "", clientName: fields[3]?.trim() || "",
      animalName: fields[4]?.trim() || "", amount, date: dateTime, division: fields[5]?.trim() || "",
    });
  }
  return entries;
}

function parseRevenueXLS(buffer: Buffer): ParsedRevenueEntry[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const entries: ParsedRevenueEntry[] = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(data.length, 50); i++) {
    const cell = (data[i]?.[0] || "").toString().toLowerCase();
    const cell1 = (data[i]?.[1] || "").toString().toLowerCase();
    if (cell.includes("date/time") && cell1.includes("referring vet clinic")) { headerIdx = i; break; }
  }
  if (headerIdx === -1) headerIdx = 9;
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 2) continue;
    const dateTime = row[0];
    const clinicName = (row[1] || "").toString().trim();
    if (!dateTime || !clinicName) continue;
    if (clinicName.toLowerCase() === "unknown clinic") continue;
    if (clinicName.toLowerCase().startsWith("total")) continue;
    const rawAmount = row[6];
    const amount = typeof rawAmount === "number" ? rawAmount : (parseFloat(String(rawAmount).replace(/[,$]/g, "")) || 0);
    if (amount <= 0) continue;
    entries.push({
      clinicName, referringVet: (row[2] || "").toString().trim(), clientName: (row[3] || "").toString().trim(),
      animalName: (row[4] || "").toString().trim(), amount, date: dateTime.toString().trim(), division: (row[5] || "").toString().trim(),
    });
  }
  return entries;
}

function parseStatisticsCSV(csvText: string): ParsedStatisticsEntry[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: ParsedStatisticsEntry[] = [];
  const headerFields = parseCSVLine(lines[0]);
  let clinicNameIdx = headerFields.findIndex((h) => h.toLowerCase().includes("clinic name"));
  let lastReferralIdx = headerFields.findIndex((h) => h.toLowerCase().includes("date of last referral"));
  let total12MonthsIdx = headerFields.findIndex((h) => h.toLowerCase().includes("total referrals 12 months"));
  if (clinicNameIdx === -1) clinicNameIdx = 0;
  if (lastReferralIdx === -1) lastReferralIdx = 2;
  if (total12MonthsIdx === -1) total12MonthsIdx = 6;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 7) continue;
    const clinicName = fields[clinicNameIdx]?.trim() || "";
    if (!clinicName || clinicName.toLowerCase() === "unknown") continue;
    const lastReferralStr = fields[lastReferralIdx]?.trim() || "";
    let lastReferralDate: string | null = null;
    if (lastReferralStr && lastReferralStr.toLowerCase() !== "n/a") {
      const parts = lastReferralStr.split("-");
      if (parts.length === 3) {
        const [month, day, year] = parts;
        lastReferralDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
    }
    entries.push({
      clinicName, lastReferralDate,
      totalReferrals12Months: parseInt(fields[total12MonthsIdx]?.trim() || "", 10) || 0,
    });
  }
  return entries;
}

function parseEzyVetDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

function aggregateRevenueByClinic(entries: ParsedRevenueEntry[]) {
  const clinicMap = new Map<string, { visits: number; revenue: number; lastDate: string | null; divisions: Set<string> }>();
  for (const entry of entries) {
    const existing = clinicMap.get(entry.clinicName) || { visits: 0, revenue: 0, lastDate: null as string | null, divisions: new Set<string>() };
    existing.visits += 1;
    existing.revenue += entry.amount;
    if (entry.division) existing.divisions.add(entry.division);
    const parsedDate = parseEzyVetDate(entry.date);
    if (parsedDate && (!existing.lastDate || parsedDate > existing.lastDate)) existing.lastDate = parsedDate;
    clinicMap.set(entry.clinicName, existing);
  }
  return Array.from(clinicMap.entries()).map(([clinicName, stats]) => ({
    clinicName, totalVisits: stats.visits, totalRevenue: Math.round(stats.revenue * 100) / 100,
    lastReferralDate: stats.lastDate, divisions: [...stats.divisions].sort(),
  }));
}

function normalizeNameForComparison(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const GENERIC_WORDS = new Set([
  "the", "and", "for", "of", "at", "in", "vet", "vets", "pet", "pets", "animal", "animals",
  "clinic", "clinics", "hospital", "hospitals", "center", "centre", "medical", "veterinary",
  "care", "health", "wellness", "group", "practice", "dr", "dvm", "inc", "llc", "corp",
]);
function extractKeywords(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}

interface MatchPartner { id: string; name: string; referral_divisions: string[] | null; last_referral_date: string | null }
function findBestMatch(clinicName: string, partners: MatchPartner[]): MatchPartner | null {
  const normalizedInput = normalizeNameForComparison(clinicName);
  let match = partners.find((p) => (p.name || "").toLowerCase().trim() === clinicName.toLowerCase().trim());
  if (match) return match;
  match = partners.find((p) => normalizeNameForComparison(p.name || "") === normalizedInput);
  if (match) return match;
  match = partners.find((p) => {
    const normalizedPartner = normalizeNameForComparison(p.name || "");
    const shorter = normalizedInput.length < normalizedPartner.length ? normalizedInput : normalizedPartner;
    if (shorter.length < 6) return false;
    return normalizedInput.includes(normalizedPartner) || normalizedPartner.includes(normalizedInput);
  });
  if (match) return match;
  const inputKeywords = extractKeywords(clinicName);
  if (inputKeywords.length === 0) return null;
  const minRequiredMatches = inputKeywords.length >= 2 ? 2 : 1;
  let bestMatch: MatchPartner | null = null;
  let bestScore = 0;
  for (const p of partners) {
    const partnerKeywords = extractKeywords(p.name || "");
    if (partnerKeywords.length === 0) continue;
    let matchCount = 0;
    for (const iw of inputKeywords) if (partnerKeywords.some((pw) => pw === iw)) matchCount++;
    if (matchCount >= minRequiredMatches && matchCount > bestScore) { bestScore = matchCount; bestMatch = p; }
  }
  return bestMatch;
}

export async function parseReferralUpload(formData: FormData): Promise<UploadResult> {
  const current = await requireReferralUser();
  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, message: "No file uploaded", error: "No file" };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { success: false, message: `File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB).`, error: "File too large" };
  }
  const filename = file.name.toLowerCase();
  const isXLS = filename.endsWith(".xls") || filename.endsWith(".xlsx");
  const isCSV = filename.endsWith(".csv");
  if (!isCSV && !isXLS) return { success: false, message: "Please upload a CSV or XLS file.", error: "Bad file type" };

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminClient();

  let reportType: ReportType;
  let revenueEntries: ParsedRevenueEntry[] = [];
  let statisticsEntries: ParsedStatisticsEntry[] = [];

  if (isXLS) {
    reportType = "revenue";
    revenueEntries = parseRevenueXLS(fileBuffer);
  } else {
    const csvText = fileBuffer.toString("utf-8");
    reportType = detectReportType(csvText);
    if (reportType === "revenue") revenueEntries = parseRevenueCSV(csvText);
    else statisticsEntries = parseStatisticsCSV(csvText);
  }

  const { data: partners } = await fetchAllRows<MatchPartner>((from, to) =>
    admin
      .from("referral_partners")
      .select("id, name, total_referrals_all_time, total_revenue_all_time, last_contact_date, last_referral_date, referral_divisions")
      .range(from, to),
  );
  if (!partners) return { success: false, message: "Failed to fetch partners", error: "DB error" };

  const result: UploadResult["details"] = [];
  let updated = 0, skipped = 0, notMatched = 0, revenueAdded = 0, visitorsAdded = 0;

  const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
  const { data: syncRow, error: syncErr } = await admin
    .from("referral_sync_history")
    .insert({
      filename: file.name || "referral-report.csv",
      uploaded_by: current.authId,
      content_hash: contentHash,
      report_type: reportType,
      data_source: "csv_upload",
      sync_details: { stage: "started" },
    })
    .select("id")
    .single();
  if (syncErr || !syncRow) return { success: false, message: `Failed to record upload: ${syncErr?.message}`, error: syncErr?.message };
  const uploadId = syncRow.id as string;

  let newRows: number | null = null;
  let totalRows: number | null = null;
  let invalidDateRows = 0;
  let dateRange: { start: string; end: string } | null = null;

  if (reportType === "revenue") {
    if (revenueEntries.length === 0) {
      return { success: false, message: "No valid entries found. Check the file has Date/Time, Referring Vet Clinic and Amount columns.", error: "Empty" };
    }
    const aggregated = aggregateRevenueByClinic(revenueEntries);
    const clinicToPartner = new Map<string, MatchPartner>();
    for (const agg of aggregated) {
      const m = findBestMatch(agg.clinicName, partners as MatchPartner[]);
      if (m) clinicToPartner.set(agg.clinicName, m);
    }
    const syncDate = new Date().toISOString();
    const partnerUpdates = new Map<string, Record<string, unknown>>();
    for (const agg of aggregated) {
      const m = clinicToPartner.get(agg.clinicName);
      if (!m) {
        notMatched++;
        result.push({ clinicName: agg.clinicName, matched: false, visits: agg.totalVisits, revenue: agg.totalRevenue, lastVisitDate: agg.lastReferralDate || undefined, divisions: agg.divisions });
        continue;
      }
      const existingDivisions = m.referral_divisions || [];
      const mergedDivisions = [...new Set([...existingDivisions, ...agg.divisions])].sort();
      partnerUpdates.set(m.id, {
        referral_divisions: mergedDivisions, last_sync_date: syncDate, last_data_source: "csv_upload",
      });
      updated++;
      revenueAdded += agg.totalRevenue;
      visitorsAdded += agg.totalVisits;
      result.push({ clinicName: agg.clinicName, matched: true, matchedTo: m.name, visits: agg.totalVisits, revenue: agg.totalRevenue, lastVisitDate: agg.lastReferralDate || undefined, divisions: agg.divisions });
    }
    await mapWithConcurrency([...partnerUpdates], 10, async ([id, patch]) => {
      await admin.from("referral_partners").update(patch).eq("id", id);
    });

    // Build line items with sequence-aware dedup hashes
    const sortedEntries = [...revenueEntries].sort((a, b) => {
      const aDate = parseEzyVetDate(a.date) || a.date;
      const bDate = parseEzyVetDate(b.date) || b.date;
      return aDate.localeCompare(bDate) || a.clinicName.localeCompare(b.clinicName) || a.clientName.localeCompare(b.clientName) ||
        a.animalName.localeCompare(b.animalName) || (a.amount - b.amount) || a.referringVet.localeCompare(b.referringVet);
    });
    const seqCounters = new Map<string, number>();
    const lineItemRows: Record<string, unknown>[] = [];
    for (const entry of sortedEntries) {
      const parsedDate = parseEzyVetDate(entry.date);
      if (!parsedDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) { invalidDateRows++; continue; }
      const partner = clinicToPartner.get(entry.clinicName);
      const seqKey = [parsedDate, entry.clinicName, entry.clientName, entry.animalName, entry.amount.toFixed(2)].join("|");
      const seq = (seqCounters.get(seqKey) ?? 0) + 1;
      seqCounters.set(seqKey, seq);
      const dedupHash = createHash("sha256").update(`${seqKey}|${entry.referringVet}|${seq}`).digest("hex").slice(0, 40);
      lineItemRows.push({
        partner_id: partner?.id || null, transaction_date: parsedDate, csv_clinic_name: entry.clinicName,
        referring_vet: entry.referringVet || null, client_name: entry.clientName || null, animal_name: entry.animalName || null,
        division: entry.division || null, amount: Math.round(entry.amount * 100) / 100, dedup_hash: dedupHash,
        row_index: seq, upload_id: uploadId,
      });
    }

    let inserted = 0;
    for (let i = 0; i < lineItemRows.length; i += 500) {
      const batch = lineItemRows.slice(i, i + 500);
      const { data: ins } = await admin
        .from("referral_revenue_line_items")
        .upsert(batch, { onConflict: "dedup_hash", ignoreDuplicates: true })
        .select("id");
      inserted += ins?.length || 0;
    }
    newRows = inserted;
    totalRows = lineItemRows.length;
    skipped = totalRows - newRows;

    const parsedDates = lineItemRows.map((r) => r.transaction_date as string).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    dateRange = parsedDates.length ? { start: parsedDates[0], end: parsedDates[parsedDates.length - 1] } : null;
  } else {
    if (statisticsEntries.length === 0) {
      return { success: false, message: "No valid entries found in Statistics CSV.", error: "Empty" };
    }
    const syncDate = new Date().toISOString();
    const partnerUpdates = new Map<string, Record<string, unknown>>();
    for (const entry of statisticsEntries) {
      const m = findBestMatch(entry.clinicName, partners as MatchPartner[]);
      if (m) {
        const updateData: Record<string, unknown> = {
          referrals_last_12_months: entry.totalReferrals12Months, last_sync_date: syncDate, last_data_source: "csv_upload",
        };
        if (entry.lastReferralDate) {
          updateData.last_contact_date = entry.lastReferralDate;
          const existing = m.last_referral_date ? String(m.last_referral_date).split("T")[0] : null;
          if (!existing || entry.lastReferralDate > existing) updateData.last_referral_date = entry.lastReferralDate;
        }
        partnerUpdates.set(m.id, updateData);
        updated++;
        visitorsAdded += entry.totalReferrals12Months;
        result.push({ clinicName: entry.clinicName, matched: true, matchedTo: m.name, visits: entry.totalReferrals12Months, revenue: 0, lastVisitDate: entry.lastReferralDate || undefined });
      } else {
        notMatched++;
        result.push({ clinicName: entry.clinicName, matched: false, visits: entry.totalReferrals12Months, revenue: 0, lastVisitDate: entry.lastReferralDate || undefined });
      }
    }
    await mapWithConcurrency([...partnerUpdates], 10, async ([id, patch]) => {
      await admin.from("referral_partners").update(patch).eq("id", id);
    });
    const statsDates = statisticsEntries.map((e) => e.lastReferralDate).filter((d): d is string => !!d).sort();
    dateRange = statsDates.length ? { start: statsDates[0], end: statsDates[statsDates.length - 1] } : null;
  }

  await admin.from("referral_sync_history").update({
    date_range_start: dateRange?.start || null,
    date_range_end: dateRange?.end || null,
    total_rows_parsed: totalRows ?? result.length,
    total_rows_matched: updated,
    total_rows_skipped: skipped,
    total_revenue_added: revenueAdded,
    sync_details: { reportType, notMatched, visitorsAdded, newRows, clinicDetails: result },
  }).eq("id", uploadId);

  await admin.rpc("recalculate_partner_metrics");

  await recordAudit({
    actorId: current.authId, actorEmail: current.email,
    action: "referral.upload", entityId: uploadId,
    summary: `${reportType} upload: ${updated} partners updated`,
    metadata: { revenueAdded, visitorsAdded, notMatched },
  });

  const overlapWarning = reportType === "revenue" && totalRows && newRows !== null && newRows < totalRows
    ? `${(totalRows - newRows).toLocaleString()} of ${totalRows.toLocaleString()} rows were already on file and were skipped.`
    : null;
  const isDuplicateUpload = reportType === "revenue" && !!totalRows && newRows === 0;

  revalidatePath("/crm/referral");
  return {
    success: true, reportType, uploadId,
    message: reportType === "revenue"
      ? `Revenue Report: Updated ${updated} partners — ${visitorsAdded.toLocaleString()} referrals, $${revenueAdded.toLocaleString()} revenue`
      : `Statistics Report: Updated ${updated} partners with ${visitorsAdded} visits`,
    updated, skipped, notMatched,
    revenueAdded: Math.round(revenueAdded * 100) / 100, visitorsAdded,
    newRows, totalRows, invalidDateRows, dateRange, overlapWarning, isDuplicateUpload, details: result,
  };
}
