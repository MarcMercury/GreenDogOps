"use server";

import { revalidatePath } from "next/cache";
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
