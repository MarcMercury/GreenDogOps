"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function updateOrganization(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();
  const patch = {
    name: str(formData.get("name")) ?? "Unknown",
    subtype: str(formData.get("subtype")),
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
    last_visit_date: str(formData.get("last_visit_date")),
    last_contact_date: str(formData.get("last_contact_date")),
    notes: str(formData.get("notes")),
  };
  const { error } = await supabase
    .from("crm_organization")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/org/${id}`);
  revalidatePath("/crm", "layout");
  return { ok: true };
}

export async function updateContact(
  id: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();
  const patch = {
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
    start_date: str(formData.get("start_date")),
    end_date: str(formData.get("end_date")),
    hours_completed: num(formData.get("hours_completed")),
    hours_required: num(formData.get("hours_required")),
    eligible_for_employment: bool(formData.get("eligible_for_employment")),
    ce_events_attended: str(formData.get("ce_events_attended")),
    lead_source: str(formData.get("lead_source")),
    notes: str(formData.get("notes")),
  };
  const { error } = await supabase
    .from("crm_contact")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/crm/contact/${id}`);
  revalidatePath("/crm", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Promote a student (crm_contact) into the Recruiting CRM (ATS).
// Creates a unified greendogops.person (status='applicant') + a person_recruiting
// row, copying the student's details so nothing is lost, and links the records
// in both directions. Idempotent: re-promoting just returns the existing record.
// From the ATS the same person can later be hired (status -> 'employee').
// ---------------------------------------------------------------------------
export async function promoteStudentToRecruiting(
  contactId: string,
): Promise<void> {
  const supabase = await createClient();

  const { data: contact, error: loadErr } = await supabase
    .from("crm_contact")
    .select(
      `id, contact_type, first_name, last_name, full_name, email, phone,
       status, organization, program_type, program_name, cohort, school,
       location, mentor, coordinator, start_date, end_date, hours_completed,
       hours_required, eligible_for_employment, lead_source, notes,
       promoted_person_id`,
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
