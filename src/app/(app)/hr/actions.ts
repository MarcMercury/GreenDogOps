"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function updateEmployee(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();

  const personPatch = {
    first_name: str(formData.get("first_name")),
    last_name: str(formData.get("last_name")),
    preferred_name: str(formData.get("preferred_name")),
    grid_name: str(formData.get("grid_name")),
    email: str(formData.get("email")),
    phone_mobile: str(formData.get("phone_mobile")),
    date_of_birth: str(formData.get("date_of_birth")),
    postal_code: str(formData.get("postal_code")),
    work_location_type: str(formData.get("work_location_type")),
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
    days_per_week: num(formData.get("days_per_week")),
    hire_date: str(formData.get("hire_date")),
    original_hire_date: str(formData.get("original_hire_date")),
    pay_type: str(formData.get("pay_type")),
    current_rate: num(formData.get("current_rate")),
    biweekly_wage: num(formData.get("biweekly_wage")),
    annual_wages: num(formData.get("annual_wages")),
    pto_policy_allotment: num(formData.get("pto_policy_allotment")),
    pto_used: num(formData.get("pto_used")),
    pto_available: num(formData.get("pto_available")),
    pto_notes: str(formData.get("pto_notes")),
    ce_budget: num(formData.get("ce_budget")),
    ce_used: num(formData.get("ce_used")),
    ce_remaining: num(formData.get("ce_remaining")),
    benefits_enrolled: bool(formData.get("benefits_enrolled")),
    benefits_monthly: num(formData.get("benefits_monthly")),
    benefits_annual: num(formData.get("benefits_annual")),
    last_review_date: str(formData.get("last_review_date")),
    separation_date: str(formData.get("separation_date")),
    separation_type: str(formData.get("separation_type")),
    separation_letter_signed: bool(formData.get("separation_letter_signed")),
    separation_notes: str(formData.get("separation_notes")),
  };

  const { error: eErr } = await supabase
    .from("person_employment")
    .upsert({ person_id: personId, ...empPatch }, { onConflict: "person_id" });

  if (eErr) return { ok: false, error: eErr.message };

  revalidatePath(`/hr/${personId}`);
  revalidatePath("/hr");
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
// Documents (file uploads go to the private employee-documents Storage bucket)
// ---------------------------------------------------------------------------

export async function uploadDocument(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
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
