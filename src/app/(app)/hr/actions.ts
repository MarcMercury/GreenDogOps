"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCanEdit } from "@/lib/auth/session";
import { canViewAllCompensation } from "@/lib/auth/permissions";
import { ONBOARDING_ITEM_KEYS } from "@/lib/hr/onboarding";

const DOCUMENTS_BUCKET = "employee-documents";

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

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Create a brand-new person + employment record from the "Add New Employee"
 * wizard. Returns the new person id so the caller can navigate to the profile.
 */
export async function createEmployee(
  formData: FormData,
): Promise<CreateResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const isAdmin = canViewAllCompensation(gate.current.appUser.role);

  const firstName = str(formData.get("first_name"));
  const lastName = str(formData.get("last_name"));
  if (!firstName && !lastName) {
    return { ok: false, error: "A first or last name is required." };
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  const personInsert = {
    first_name: firstName,
    last_name: lastName,
    preferred_name: str(formData.get("preferred_name")),
    grid_name: str(formData.get("grid_name")),
    full_name: fullName,
    email: str(formData.get("email")),
    phone_mobile: str(formData.get("phone_mobile")),
    phone_home: str(formData.get("phone_home")),
    phone_other: str(formData.get("phone_other")),
    date_of_birth: str(formData.get("date_of_birth")),
    postal_code: str(formData.get("postal_code")),
    work_location_type: str(formData.get("work_location_type")),
    opportunity_type: str(formData.get("opportunity_type")),
    status: str(formData.get("status")) ?? "employee",
    notes: str(formData.get("notes")),
  };

  const { data: person, error: pErr } = await supabase
    .from("person")
    .insert(personInsert)
    .select("id")
    .single();

  if (pErr) return { ok: false, error: pErr.message };
  const personId = person.id as string;

  const empInsert = {
    person_id: personId,
    adp_job_title: str(formData.get("adp_job_title")),
    offer_title: str(formData.get("offer_title")),
    flsa_status: str(formData.get("flsa_status")),
    work_schedule: str(formData.get("work_schedule")),
    hire_date: str(formData.get("hire_date")),
    original_hire_date:
      str(formData.get("original_hire_date")) ?? str(formData.get("hire_date")),
    ...(isAdmin
      ? {
          pay_type: str(formData.get("pay_type")),
          current_rate: num(formData.get("current_rate")),
          annual_wages: num(formData.get("annual_wages")),
        }
      : {}),
  };

  const { error: eErr } = await supabase
    .from("person_employment")
    .insert(empInsert);

  if (eErr) {
    // Roll back the orphaned person so we don't leave a half-created record.
    await supabase.from("person").delete().eq("id", personId);
    return { ok: false, error: eErr.message };
  }

  revalidatePath("/hr");
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  return { ok: true, id: personId };
}

export async function updateEmployee(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const isAdmin = canViewAllCompensation(gate.current.appUser.role);

  const personPatch = {
    first_name: str(formData.get("first_name")),
    last_name: str(formData.get("last_name")),
    preferred_name: str(formData.get("preferred_name")),
    grid_name: str(formData.get("grid_name")),
    email: str(formData.get("email")),
    phone_mobile: str(formData.get("phone_mobile")),
    phone_home: str(formData.get("phone_home")),
    phone_other: str(formData.get("phone_other")),
    date_of_birth: str(formData.get("date_of_birth")),
    postal_code: str(formData.get("postal_code")),
    work_location_type: str(formData.get("work_location_type")),
    opportunity_type: str(formData.get("opportunity_type")),
    status: str(formData.get("status")) ?? "employee",
    notes: str(formData.get("notes")),
  };

  const { error: pErr } = await supabase
    .from("person")
    .update(personPatch)
    .eq("id", personId);

  if (pErr) return { ok: false, error: pErr.message };

  const empPatch = {
    adp_job_title: str(formData.get("adp_job_title")),
    offer_title: str(formData.get("offer_title")),
    flsa_status: str(formData.get("flsa_status")),
    work_schedule: str(formData.get("work_schedule")),
    // days_per_week is sourced from Schedule → Setup (sched_employee_setting
    // .weekly_shift_target) and shown read-only on HR, so it is not written here.
    hire_date: str(formData.get("hire_date")),
    original_hire_date: str(formData.get("original_hire_date")),
    pto_policy_allotment: num(formData.get("pto_policy_allotment")),
    pto_used: num(formData.get("pto_used")),
    pto_available: num(formData.get("pto_available")),
    pto_notes: str(formData.get("pto_notes")),
    separation_date: str(formData.get("separation_date")),
    separation_type: str(formData.get("separation_type")),
    separation_letter_signed: bool(formData.get("separation_letter_signed")),
    separation_notes: str(formData.get("separation_notes")),
    // Compensation/benefits fields are admin-only. Non-admins never submit
    // them, so we omit them entirely to avoid overwriting with null.
    ...(isAdmin
      ? {
          pay_type: str(formData.get("pay_type")),
          current_rate: num(formData.get("current_rate")),
          biweekly_wage: num(formData.get("biweekly_wage")),
          annual_wages: num(formData.get("annual_wages")),
          ce_budget: num(formData.get("ce_budget")),
          ce_used: num(formData.get("ce_used")),
          ce_remaining: num(formData.get("ce_remaining")),
          benefits_enrolled: bool(formData.get("benefits_enrolled")),
          benefits_monthly: num(formData.get("benefits_monthly")),
          benefits_annual: num(formData.get("benefits_annual")),
          last_review_date: str(formData.get("last_review_date")),
        }
      : {}),
  };

  const { error: eErr } = await supabase
    .from("person_employment")
    .upsert({ person_id: personId, ...empPatch }, { onConflict: "person_id" });

  if (eErr) return { ok: false, error: eErr.message };

  revalidatePath(`/hr/${personId}`);
  revalidatePath("/hr");
  // A status change cascades (in the DB) into scheduling eligibility and any
  // linked login account — revalidate those views so they reflect it too.
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  revalidatePath("/admin/users");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function saveReview(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("review_id"));

  const patch = {
    person_id: personId,
    review_date: str(formData.get("review_date")),
    review_type: str(formData.get("review_type")),
    reviewer: str(formData.get("reviewer")),
    rating: str(formData.get("rating")),
    summary: str(formData.get("summary")),
    next_review_date: str(formData.get("next_review_date")),
  };

  const { error } = id
    ? await supabase.from("person_review").update(patch).eq("id", id)
    : await supabase.from("person_review").insert(patch);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteReview(
  personId: string,
  reviewId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_review")
    .delete()
    .eq("id", reviewId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function saveAsset(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("asset_id"));
  const assetName = str(formData.get("asset_name"));
  if (!assetName) return { ok: false, error: "Asset name is required." };

  const patch = {
    person_id: personId,
    asset_name: assetName,
    asset_type: str(formData.get("asset_type")),
    identifier: str(formData.get("identifier")),
    assigned_date: str(formData.get("assigned_date")),
    returned_date: str(formData.get("returned_date")),
    status: str(formData.get("status")) ?? "assigned",
    notes: str(formData.get("notes")),
  };

  const { error } = id
    ? await supabase.from("person_asset").update(patch).eq("id", id)
    : await supabase.from("person_asset").insert(patch);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteAsset(
  personId: string,
  assetId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_asset")
    .delete()
    .eq("id", assetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Onboarding checklist (bulk save of the whole checklist grid)
// ---------------------------------------------------------------------------

export async function saveOnboarding(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  // Build one upsert row per catalog item from the submitted form fields.
  const rows = ONBOARDING_ITEM_KEYS.map((key) => {
    const provided = bool(formData.get(`${key}__provided`));
    const completed = bool(formData.get(`${key}__completed`));
    // Only keep a date when its checkbox is set, so clearing a box clears its date.
    return {
      person_id: personId,
      item_key: key,
      provided,
      provided_date: provided ? str(formData.get(`${key}__provided_date`)) : null,
      completed,
      completed_date: completed
        ? str(formData.get(`${key}__completed_date`))
        : null,
      notes: str(formData.get(`${key}__notes`)),
    };
  });

  const { error } = await supabase
    .from("person_onboarding_item")
    .upsert(rows, { onConflict: "person_id,item_key" });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Annual compliance log (ongoing dated entries per compliance track)
// ---------------------------------------------------------------------------

/** Append one dated entry to a person's compliance log. */
export async function addComplianceEntry(
  personId: string,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const complianceKey = str(formData.get("compliance_key"));
  const label = str(formData.get("label"));
  const completedDate = str(formData.get("completed_date"));
  if (!complianceKey || !label) {
    return { ok: false, error: "A compliance item is required." };
  }
  if (!completedDate) {
    return { ok: false, error: "A completed date is required." };
  }

  const { error } = await supabase.from("person_compliance_entry").insert({
    person_id: personId,
    compliance_key: complianceKey,
    label,
    completed_date: completedDate,
    notes: str(formData.get("notes")),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

/** Remove a single compliance-log entry. */
export async function deleteComplianceEntry(
  personId: string,
  entryId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const { error } = await supabase
    .from("person_compliance_entry")
    .delete()
    .eq("id", entryId)
    .eq("person_id", personId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Employee licenses (DVM / RVT / DEA … — an editable, renewable list)
// ---------------------------------------------------------------------------

/**
 * Insert a new license (when `licenseId` is null) or update an existing one.
 * Editing lets HR bump the expiration date as a credential is renewed.
 */
export async function saveLicense(
  personId: string,
  licenseId: string | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "A license name is required." };

  const payload = {
    person_id: personId,
    name,
    license_number: str(formData.get("license_number")),
    issuing_authority: str(formData.get("issuing_authority")),
    issued_date: str(formData.get("issued_date")),
    expiration_date: str(formData.get("expiration_date")),
    notes: str(formData.get("notes")),
  };

  const { error } = licenseId
    ? await supabase
        .from("person_license")
        .update(payload)
        .eq("id", licenseId)
        .eq("person_id", personId)
    : await supabase.from("person_license").insert(payload);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteLicense(
  personId: string,
  licenseId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const { error } = await supabase
    .from("person_license")
    .delete()
    .eq("id", licenseId)
    .eq("person_id", personId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function savePtoDay(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const ptoDate = str(formData.get("pto_date"));
  if (!ptoDate) return { ok: false, error: "A date is required." };

  const { error } = await supabase.from("person_pto_day").insert({
    person_id: personId,
    pto_date: ptoDate,
    hours: num(formData.get("hours")),
    note: str(formData.get("note")),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deletePtoDay(
  personId: string,
  ptoDayId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_pto_day")
    .delete()
    .eq("id", ptoDayId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Time-off requests (PTO / Vacation / Time off) — employee-level input that
// feeds the scheduler's color coding (requested=amber, approved=green).
// ---------------------------------------------------------------------------

const TIME_OFF_KINDS = ["pto", "vacation", "time_off"] as const;

export async function saveTimeOff(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const start = str(formData.get("start_date"));
  const end = str(formData.get("end_date")) ?? start;
  if (!start) return { ok: false, error: "A start date is required." };
  if (end && end < start)
    return { ok: false, error: "End date cannot be before the start date." };

  const kindRaw = str(formData.get("kind"));
  const kind = TIME_OFF_KINDS.includes(kindRaw as (typeof TIME_OFF_KINDS)[number])
    ? kindRaw
    : "pto";

  const { error } = await supabase.from("person_time_off").insert({
    person_id: personId,
    kind,
    status: "requested",
    start_date: start,
    end_date: end,
    note: str(formData.get("note")),
    requested_by: gate.current.appUser.person_id ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function reviewTimeOff(
  personId: string,
  timeOffId: string,
  status: "approved" | "denied" | "requested",
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const reviewed = status === "requested";
  const { error } = await supabase
    .from("person_time_off")
    .update({
      status,
      reviewed_by: reviewed ? null : (gate.current.appUser.person_id ?? null),
      reviewed_at: reviewed ? null : new Date().toISOString(),
    })
    .eq("id", timeOffId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/hr/${personId}`);
  revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteTimeOff(
  personId: string,
  timeOffId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_time_off")
    .delete()
    .eq("id", timeOffId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/hr/${personId}`);
  revalidatePath("/schedule");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents (file uploads go to the private employee-documents Storage bucket)
// ---------------------------------------------------------------------------
export async function uploadDocument(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
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
  const storagePath = `${personId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await admin.from("person_document").insert({
    person_id: personId,
    title: str(formData.get("title")) ?? file.name,
    category: str(formData.get("category")),
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
  });

  if (dbErr) {
    // Roll back the orphaned upload so storage and the table stay in sync.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { ok: false, error: dbErr.message };
  }

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteDocument(
  personId: string,
  documentId: string,
  storagePath: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const admin = createAdminClient();

  await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

  const { error } = await admin
    .from("person_document")
    .delete()
    .eq("id", documentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}
