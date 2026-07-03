"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureEditor } from "@/lib/auth/session";
import {
  crmSlugForOrgType,
  crmSlugForContactType,
  ORG_TYPE_LABELS,
  CONTACT_TYPE_LABELS,
  type OrgType,
  type ContactType,
} from "@/lib/crm/types";

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

/** Join repeated form values (e.g. multi-select) into a comma-separated string. */
function list(values: FormDataEntryValue[]): string | null {
  const items = values
    .map((v) => String(v).trim())
    .filter(Boolean);
  return items.length ? items.join(", ") : null;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

export type SaveResult = { ok: true } | { ok: false; error: string };

function organizationPatch(formData: FormData) {
  return {
    name: str(formData.get("name")) ?? "Unknown",
    subtype: str(formData.get("subtype")),
    category: str(formData.get("category")),
    status: str(formData.get("status")),
    contact_name: str(formData.get("contact_name")),
    title: str(formData.get("title")),
    phone: str(formData.get("phone")),
    phone_alt: str(formData.get("phone_alt")),
    email: str(formData.get("email")),
    website: str(formData.get("website")),
    instagram: str(formData.get("instagram")),
    address: str(formData.get("address")),
    city: str(formData.get("city")),
    state: str(formData.get("state")),
    zip: str(formData.get("zip")),
    area: str(formData.get("area")),
    clinic_area: list(formData.getAll("clinic_area")),
    services: str(formData.get("services")),
    tier: str(formData.get("tier")),
    priority: str(formData.get("priority")),
    membership_level: str(formData.get("membership_level")),
    annual_fee: num(formData.get("annual_fee")),
    account_number: str(formData.get("account_number")),
    account_rep: str(formData.get("account_rep")),
    total_referrals: num(formData.get("total_referrals")),
    revenue: num(formData.get("revenue")),
    monthly_spend: num(formData.get("monthly_spend")),
    spend_ytd: num(formData.get("spend_ytd")),
    relationship_score: num(formData.get("relationship_score")),
    internal_rating: num(formData.get("internal_rating")),
    is_preferred: bool(formData.get("is_preferred")),
    is_active: bool(formData.get("is_active")),
    agreement_status: str(formData.get("agreement_status")),
    agreement_signed_date: str(formData.get("agreement_signed_date")),
    tax_id: str(formData.get("tax_id")),
    secondary_contact_name: str(formData.get("secondary_contact_name")),
    secondary_contact_title: str(formData.get("secondary_contact_title")),
    secondary_contact_email: str(formData.get("secondary_contact_email")),
    secondary_contact_phone: str(formData.get("secondary_contact_phone")),
    last_visit_date: str(formData.get("last_visit_date")),
    last_contact_date: str(formData.get("last_contact_date")),
    notes: str(formData.get("notes")),
  };
}

export async function updateOrganization(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const patch = organizationPatch(formData);
  const { error } = await supabase
    .from("crm_organization")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/org/${id}`);
  revalidatePath("/crm", "layout");
  return { ok: true };
}

export async function createOrganization(
  defaultOrgType: OrgType,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const requested = str(formData.get("org_type")) as OrgType | null;
  const orgType =
    requested && requested in ORG_TYPE_LABELS ? requested : defaultOrgType;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_organization")
    .insert({ ...organizationPatch(formData), org_type: orgType, source: "manual" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm", "layout");
  redirect(`/crm/org/${(data as { id: string }).id}`);
}

// ---------------------------------------------------------------------------
// Organization document attachments (files go to the private crm-documents
// Storage bucket; rows live in greendogops.crm_org_document).
// ---------------------------------------------------------------------------
const CRM_DOCUMENTS_BUCKET = "crm-documents";

export async function uploadOrgDocument(
  orgId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file to upload." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: "File exceeds the 25 MB limit." };
  }

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${orgId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await admin.storage
    .from(CRM_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await admin.from("crm_org_document").insert({
    org_id: orgId,
    title: str(formData.get("title")) ?? file.name,
    category: str(formData.get("category")),
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
  });
  if (dbErr) {
    // Roll back the orphaned upload so storage and the table stay in sync.
    await admin.storage.from(CRM_DOCUMENTS_BUCKET).remove([storagePath]);
    return { ok: false, error: dbErr.message };
  }

  revalidatePath(`/crm/org/${orgId}`);
  return { ok: true };
}

export async function deleteOrgDocument(
  orgId: string,
  documentId: string,
  storagePath: string,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const admin = createAdminClient();

  await admin.storage.from(CRM_DOCUMENTS_BUCKET).remove([storagePath]);

  const { error } = await admin
    .from("crm_org_document")
    .delete()
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/crm/org/${orgId}`);
  return { ok: true };
}

function contactPatch(formData: FormData) {
  return {
    first_name: str(formData.get("first_name")),
    last_name: str(formData.get("last_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    status: str(formData.get("status")),
    organization: str(formData.get("organization")),
    program_type: str(formData.get("program_type")),
    program_name: str(formData.get("program_name")),
    cohort: str(formData.get("cohort")),
    school: str(formData.get("school")),
    location: str(formData.get("location")),
    mentor: str(formData.get("mentor")),
    coordinator: str(formData.get("coordinator")),
    visitor_type: str(formData.get("visitor_type")),
    supervising_dvm: str(formData.get("supervising_dvm")),
    weekday_schedule:
      formData
        .getAll("weekday_schedule")
        .map((v) => String(v).trim())
        .filter(Boolean)
        .join(", ") || null,
    doc_recommendation: str(formData.get("doc_recommendation")),
    degree_type: str(formData.get("degree_type")),
    hire_interest: str(formData.get("hire_interest")),
    grad_year: str(formData.get("grad_year")),
    stipend: str(formData.get("stipend")),
    completed: bool(formData.get("completed")),
    stipend_paid: bool(formData.get("stipend_paid")),
    check_cashed: bool(formData.get("check_cashed")),
    start_date: str(formData.get("start_date")),
    end_date: str(formData.get("end_date")),
    hours_completed: num(formData.get("hours_completed")),
    hours_required: num(formData.get("hours_required")),
    eligible_for_employment: bool(formData.get("eligible_for_employment")),
    opportunity_type: str(formData.get("opportunity_type")),
    ce_events_attended: str(formData.get("ce_events_attended")),
    lead_source: str(formData.get("lead_source")),
    notes: str(formData.get("notes")),
  };
}

export async function updateContact(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const patch = contactPatch(formData);
  const { error } = await supabase
    .from("crm_contact")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/contact/${id}`);
  revalidatePath("/crm", "layout");
  return { ok: true };
}

export async function createContact(
  contactType: ContactType,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const type =
    contactType in CONTACT_TYPE_LABELS ? contactType : "student";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_contact")
    .insert({ ...contactPatch(formData), contact_type: type, source: "manual" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm", "layout");
  redirect(`/crm/contact/${(data as { id: string }).id}`);
}

function influencerPatch(formData: FormData) {
  return {
    contact_name: str(formData.get("contact_name")),
    pet_name: str(formData.get("pet_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    status: str(formData.get("status")),
    tier: str(formData.get("tier")),
    priority: str(formData.get("priority")),
    relationship_status: str(formData.get("relationship_status")),
    relationship_score: num(formData.get("relationship_score")),
    needs_followup: bool(formData.get("needs_followup")),
    collaboration_type: str(formData.get("collaboration_type")),
    content_niche: str(formData.get("content_niche")),
    location: str(formData.get("location")),
    instagram_handle: str(formData.get("instagram_handle")),
    instagram_url: str(formData.get("instagram_url")),
    tiktok_handle: str(formData.get("tiktok_handle")),
    youtube_url: str(formData.get("youtube_url")),
    facebook_url: str(formData.get("facebook_url")),
    pet_instagram: str(formData.get("pet_instagram")),
    highest_platform: str(formData.get("highest_platform")),
    follower_count: num(formData.get("follower_count")),
    instagram_followers: num(formData.get("instagram_followers")),
    tiktok_followers: num(formData.get("tiktok_followers")),
    youtube_subscribers: num(formData.get("youtube_subscribers")),
    facebook_followers: num(formData.get("facebook_followers")),
    engagement_rate: num(formData.get("engagement_rate")),
    audience_age_range: str(formData.get("audience_age_range")),
    audience_gender_split: str(formData.get("audience_gender_split")),
    audience_location: str(formData.get("audience_location")),
    agreement_details: str(formData.get("agreement_details")),
    promo_code: str(formData.get("promo_code")),
    ezyvet_tracking: str(formData.get("ezyvet_tracking")),
    compensation_type: str(formData.get("compensation_type")),
    compensation_rate: num(formData.get("compensation_rate")),
    commission_percentage: num(formData.get("commission_percentage")),
    total_paid: num(formData.get("total_paid")),
    total_value_generated: num(formData.get("total_value_generated")),
    contract_start_date: str(formData.get("contract_start_date")),
    contract_end_date: str(formData.get("contract_end_date")),
    posts_completed: num(formData.get("posts_completed")),
    stories_completed: num(formData.get("stories_completed")),
    reels_completed: num(formData.get("reels_completed")),
    events_attended: num(formData.get("events_attended")),
    pet_breed: str(formData.get("pet_breed")),
    pet_type: str(formData.get("pet_type")),
    pet_age: str(formData.get("pet_age")),
    last_post_date: str(formData.get("last_post_date")),
    last_contact_date: str(formData.get("last_contact_date")),
    next_followup_date: str(formData.get("next_followup_date")),
    bio: str(formData.get("bio")),
    notes: str(formData.get("notes")),
  };
}

export async function updateInfluencer(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const patch = influencerPatch(formData);
  const { error } = await supabase
    .from("marketing_influencers")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/influencer/${id}`);
  revalidatePath("/crm", "layout");
  return { ok: true };
}

export async function createInfluencer(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("marketing_influencers")
    .insert({ ...influencerPatch(formData), source: "manual" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm", "layout");
  redirect(`/crm/influencer/${(data as { id: string }).id}`);
}

// ---------------------------------------------------------------------------
// Delete actions — remove a CRM record and redirect back to its list view.
// Each returns a SaveResult only on failure; on success it redirects.
// ---------------------------------------------------------------------------
export async function deleteOrganization(id: string): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("crm_organization")
    .select("org_type")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("crm_organization")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  const slug = org
    ? crmSlugForOrgType((org as { org_type: OrgType }).org_type)
    : null;
  revalidatePath("/crm", "layout");
  redirect(slug ? `/crm/${slug}` : "/crm");
}

export async function deleteContact(id: string): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("crm_contact")
    .select("contact_type")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("crm_contact")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  const slug = contact
    ? crmSlugForContactType((contact as { contact_type: ContactType }).contact_type)
    : null;
  revalidatePath("/crm", "layout");
  redirect(slug ? `/crm/${slug}` : "/crm");
}

export async function deleteInfluencer(id: string): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_influencers")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm", "layout");
  redirect("/crm/influencer");
}

// ---------------------------------------------------------------------------
// CE attendance — each CE lead can be tied to one or more continuing-education
// events, with prep/payment status tracked per event.
// ---------------------------------------------------------------------------
function ceAttendancePatch(formData: FormData) {
  return {
    ce_event_id: str(formData.get("ce_event_id")),
    ce_name: str(formData.get("ce_name")) ?? "Untitled CE",
    ce_date: str(formData.get("ce_date")),
    confirmed_date: str(formData.get("confirmed_date")),
    paid: bool(formData.get("paid")),
    showed_up: bool(formData.get("showed_up")),
    materials_prepared: bool(formData.get("materials_prepared")),
    notes: str(formData.get("notes")),
  };
}

export async function addCeAttendance(
  contactId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_attendance")
    .insert({ contact_id: contactId, ...ceAttendancePatch(formData) });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/contact/${contactId}`);
  revalidatePath("/crm/ce");
  return { ok: true };
}

export async function updateCeAttendance(
  id: string,
  contactId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_attendance")
    .update(ceAttendancePatch(formData))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/contact/${contactId}`);
  revalidatePath("/crm/ce");
  return { ok: true };
}

export async function deleteCeAttendance(
  id: string,
  contactId: string,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_attendance")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/contact/${contactId}`);
  revalidatePath("/crm/ce");
  return { ok: true };
}

// Quick-toggle a single field on an attendance row — used by the live CE Events
// check-in grid. Booleans flip directly; `confirmed_date` is set to today when
// turned on and cleared when turned off.
const CE_TOGGLE_FIELDS = [
  "paid",
  "showed_up",
  "materials_prepared",
  "confirmed_date",
] as const;
type CeToggleField = (typeof CE_TOGGLE_FIELDS)[number];

export async function setCeAttendanceField(
  id: string,
  field: CeToggleField,
  value: boolean,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  if (!CE_TOGGLE_FIELDS.includes(field)) {
    return { ok: false, error: "Invalid field" };
  }
  const patch =
    field === "confirmed_date"
      ? { confirmed_date: value ? new Date().toISOString().slice(0, 10) : null }
      : { [field]: value };
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_attendance")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/ce");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CE event — a first-class continuing-education event with its own scheduling
// and logistics details that CE leads can be rostered against.
// ---------------------------------------------------------------------------
function ceEventPatch(formData: FormData) {
  return {
    name: str(formData.get("name")) ?? "Untitled CE Event",
    event_date: str(formData.get("event_date")),
    start_time: str(formData.get("start_time")),
    end_time: str(formData.get("end_time")),
    location: str(formData.get("location")),
    subject: str(formData.get("subject")),
    presenters: str(formData.get("presenters")),
    description: str(formData.get("description")),
    cost_type: str(formData.get("cost_type")) ?? "free",
    cost_amount: num(formData.get("cost_amount")),
    audience: str(formData.get("audience")),
    status: str(formData.get("status")) ?? "planned",
    capacity: num(formData.get("capacity")),
    registration_url: str(formData.get("registration_url")),
    notes: str(formData.get("notes")),
  };
}

export async function createCeEvent(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_event")
    .insert(ceEventPatch(formData));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/ce");
  return { ok: true };
}

export async function updateCeEvent(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const patch = ceEventPatch(formData);
  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_ce_event")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Keep already-rostered attendance rows in sync with the event's name/date.
  await supabase
    .from("crm_ce_attendance")
    .update({ ce_name: patch.name, ce_date: patch.event_date })
    .eq("ce_event_id", id);
  revalidatePath("/crm/ce");
  return { ok: true };
}

export async function deleteCeEvent(id: string): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("crm_ce_event").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/ce");
  return { ok: true };
}

// Roster an existing CE lead onto a CE event (creates a linked attendance row).
export async function assignLeadToCeEvent(
  eventId: string,
  contactId: string,
): Promise<SaveResult> {
  const gate = await ensureEditor();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data: event, error: evErr } = await supabase
    .from("crm_ce_event")
    .select("name, event_date")
    .eq("id", eventId)
    .single();
  if (evErr) return { ok: false, error: evErr.message };
  const ev = event as { name: string; event_date: string | null };
  const { error } = await supabase.from("crm_ce_attendance").insert({
    contact_id: contactId,
    ce_event_id: eventId,
    ce_name: ev.name,
    ce_date: ev.event_date,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/ce");
  revalidatePath(`/crm/contact/${contactId}`);
  return { ok: true };
}


// Creates a unified greendogops.person (status='applicant') + a person_recruiting
// row, copying the student's details so nothing is lost, and links the records
// in both directions. Idempotent: re-promoting just returns the existing record.
// From the ATS the same person can later be hired (status -> 'employee').
// ---------------------------------------------------------------------------
export async function promoteStudentToRecruiting(
  contactId: string,
): Promise<void> {
  const gate = await ensureEditor();
  if (!gate.ok) redirect(`/crm/contact/${contactId}`);
  const supabase = await createClient();

  const { data: contact, error: loadErr } = await supabase
    .from("crm_contact")
    .select(
      `id, contact_type, first_name, last_name, full_name, email, phone,
       status, organization, program_type, program_name, cohort, school,
       location, mentor, coordinator, start_date, end_date, hours_completed,
       hours_required, eligible_for_employment, opportunity_type, lead_source,
       supervising_dvm, weekday_schedule, doc_recommendation, hire_interest,
       grad_year, stipend, notes, promoted_person_id`,
    )
    .eq("id", contactId)
    .maybeSingle();

  if (loadErr || !contact) {
    redirect(`/crm/contact/${contactId}`);
  }

  // Already promoted — jump straight to the existing recruiting record.
  if (contact.promoted_person_id) {
    redirect(`/ats/${contact.promoted_person_id}`);
  }

  const fullName =
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    null;

  // Create the unified person as an applicant, linked back to the student.
  const { data: person, error: personErr } = await supabase
    .from("person")
    .insert({
      status: "applicant",
      first_name: contact.first_name,
      last_name: contact.last_name,
      full_name: fullName,
      email: contact.email,
      phone_mobile: contact.phone,
      notes: contact.notes,
      opportunity_type: contact.opportunity_type,
      source_contact_id: contact.id,
    })
    .select("id")
    .single();

  if (personErr || !person) {
    redirect(`/crm/contact/${contactId}`);
  }

  // Capture the student's program details in the recruiting record.
  const statusLines = [
    contact.school ? `School: ${contact.school}` : null,
    contact.program_name ? `Program: ${contact.program_name}` : null,
    contact.cohort ? `Cohort: ${contact.cohort}` : null,
    contact.grad_year ? `Grad year: ${contact.grad_year}` : null,
    contact.supervising_dvm ? `DVM: ${contact.supervising_dvm}` : null,
    contact.weekday_schedule ? `Schedule: ${contact.weekday_schedule}` : null,
    contact.doc_recommendation ? `Doc rec: ${contact.doc_recommendation}` : null,
    contact.hire_interest ? `Hire interest: ${contact.hire_interest}` : null,
    contact.stipend ? `Stipend: ${contact.stipend}` : null,
    contact.hours_completed != null || contact.hours_required != null
      ? `Hours: ${contact.hours_completed ?? "?"}/${contact.hours_required ?? "?"}`
      : null,
    contact.eligible_for_employment ? "Eligible for employment" : null,
  ].filter(Boolean);

  await supabase.from("person_recruiting").upsert(
    {
      person_id: person.id,
      pipeline: "Students",
      stage: "New Lead",
      source: contact.lead_source ?? "Student CRM",
      target_title: contact.program_name,
      status_notes:
        statusLines.length > 0 ? `From Student CRM — ${statusLines.join(" · ")}` : "Promoted from Student CRM",
      notes: contact.notes,
    },
    { onConflict: "person_id" },
  );

  await supabase
    .from("crm_contact")
    .update({
      promoted_person_id: person.id,
      promoted_at: new Date().toISOString(),
    })
    .eq("id", contact.id);

  revalidatePath(`/crm/contact/${contactId}`);
  revalidatePath("/crm/student");
  revalidatePath("/ats");
  redirect(`/ats/${person.id}`);
}
