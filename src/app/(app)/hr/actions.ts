"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCanEdit, getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canViewAllCompensation, isAdminRole } from "@/lib/auth/permissions";
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
    schedule_type: str(formData.get("schedule_type")),
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

  // Compensation/benefits fields are admin-only. Non-admins never submit them,
  // so we omit them entirely to avoid overwriting with null.
  let compPatch: Record<string, unknown> = {};
  if (isAdmin) {
    const newRate = num(formData.get("current_rate"));

    // When the pay rate changes, stamp the change date and remember the prior
    // rate so the Compensation tab can show "Last compensation change".
    const { data: existing } = await supabase
      .from("person_employment")
      .select("current_rate")
      .eq("person_id", personId)
      .maybeSingle();
    const oldRate = existing?.current_rate ?? null;
    const rateChanged = existing != null && newRate !== oldRate;

    compPatch = {
      pay_type: str(formData.get("pay_type")),
      current_rate: newRate,
      biweekly_wage: num(formData.get("biweekly_wage")),
      annual_wages: num(formData.get("annual_wages")),
      ce_budget: num(formData.get("ce_budget")),
      ce_used: num(formData.get("ce_used")),
      ce_remaining: num(formData.get("ce_remaining")),
      benefits_enrolled: bool(formData.get("benefits_enrolled")),
      benefits_monthly: num(formData.get("benefits_monthly")),
      benefits_annual: num(formData.get("benefits_annual")),
      // last_review_date is derived from the Reviews tab, not entered here.
      ...(rateChanged
        ? {
            previous_rate: oldRate,
            latest_wage_change_date: new Date().toISOString().slice(0, 10),
          }
        : {}),
    };
  }

  const empPatch = {
    adp_job_title: str(formData.get("adp_job_title")),
    offer_title: str(formData.get("offer_title")),
    preferred_location_id: str(formData.get("preferred_location_id")),
    flsa_status: str(formData.get("flsa_status")),
    work_schedule: str(formData.get("work_schedule")),
    schedule_type: str(formData.get("schedule_type")),
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
    ...compPatch,
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
// Inline roster-grid editing
// ---------------------------------------------------------------------------

type FieldKind = "text" | "date" | "number" | "money" | "boolean";

/** Editable columns living on the `person` table, keyed to their value kind. */
const PERSON_EDIT_FIELDS: Record<string, FieldKind> = {
  first_name: "text",
  last_name: "text",
  preferred_name: "text",
  grid_name: "text",
  email: "text",
  phone_mobile: "text",
  phone_home: "text",
  phone_other: "text",
  date_of_birth: "date",
  postal_code: "text",
  work_location_type: "text",
  opportunity_type: "text",
  status: "text",
  notes: "text",
};

/** Editable non-compensation columns on the `person_employment` table. */
const EMPLOYMENT_EDIT_FIELDS: Record<string, FieldKind> = {
  adp_job_title: "text",
  offer_title: "text",
  flsa_status: "text",
  work_schedule: "text",
  schedule_type: "text",
  hire_date: "date",
  original_hire_date: "date",
  pto_policy_allotment: "number",
  pto_notes: "text",
  separation_date: "date",
  separation_type: "text",
  separation_letter_signed: "boolean",
  separation_notes: "text",
};

/** Compensation/benefits columns — writable only by comp-viewing roles. */
const EMPLOYMENT_COMP_EDIT_FIELDS: Record<string, FieldKind> = {
  pay_type: "text",
  current_rate: "money",
  biweekly_wage: "money",
  annual_wages: "money",
  benefits_enrolled: "boolean",
  benefits_monthly: "money",
  benefits_annual: "money",
  ce_budget: "money",
  ce_used: "money",
};

/** Coerce an inbound raw form value to the shape expected for a field kind. */
function coerceFieldValue(
  kind: FieldKind,
  raw: FormDataEntryValue | null,
): string | number | boolean | null {
  switch (kind) {
    case "boolean":
      return bool(raw);
    case "number":
    case "money":
      return num(raw);
    default:
      return str(raw);
  }
}

/**
 * Update a single employee field from the inline roster grid. Writes to the
 * same `person` / `person_employment` tables the profile form uses, so both
 * the grid and the individual profile stay in sync. Compensation/benefits
 * fields are gated to comp-viewing (Admin / HR-Manager) roles.
 */
export async function updateEmployeeField(
  personId: string,
  field: string,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const isAdmin = canViewAllCompensation(gate.current.appUser.role);

  const raw = formData.get("value");

  if (field in PERSON_EDIT_FIELDS) {
    const value = coerceFieldValue(PERSON_EDIT_FIELDS[field], raw);
    const patch: Record<string, unknown> = {
      [field]: field === "status" ? (value ?? "employee") : value,
    };

    const { error } = await supabase
      .from("person")
      .update(patch)
      .eq("id", personId);
    if (error) return { ok: false, error: error.message };

    // Keep the derived full_name in step with first/last edits.
    if (field === "first_name" || field === "last_name") {
      const { data: person } = await supabase
        .from("person")
        .select("first_name, last_name")
        .eq("id", personId)
        .maybeSingle();
      const fullName =
        [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
        null;
      await supabase
        .from("person")
        .update({ full_name: fullName })
        .eq("id", personId);
    }
  } else if (field in EMPLOYMENT_EDIT_FIELDS) {
    const value = coerceFieldValue(EMPLOYMENT_EDIT_FIELDS[field], raw);
    const { error } = await supabase
      .from("person_employment")
      .upsert({ person_id: personId, [field]: value }, { onConflict: "person_id" });
    if (error) return { ok: false, error: error.message };
  } else if (field in EMPLOYMENT_COMP_EDIT_FIELDS) {
    if (!isAdmin) {
      return {
        ok: false,
        error: "You do not have permission to edit compensation.",
      };
    }
    const value = coerceFieldValue(EMPLOYMENT_COMP_EDIT_FIELDS[field], raw);
    const patch: Record<string, unknown> = { [field]: value };

    // Mirror the profile form: stamp the change date + prior rate on a raise.
    if (field === "current_rate") {
      const { data: existing } = await supabase
        .from("person_employment")
        .select("current_rate")
        .eq("person_id", personId)
        .maybeSingle();
      const oldRate = existing?.current_rate ?? null;
      if (existing != null && value !== oldRate) {
        patch.previous_rate = oldRate;
        patch.latest_wage_change_date = new Date().toISOString().slice(0, 10);
      }
    }

    const { error } = await supabase
      .from("person_employment")
      .upsert({ person_id: personId, ...patch }, { onConflict: "person_id" });
    if (error) return { ok: false, error: error.message };
  } else {
    return { ok: false, error: "This field is not editable." };
  }

  revalidatePath(`/hr/${personId}`);
  revalidatePath("/hr");
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  revalidatePath("/admin/users");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

type DbClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Re-derive person_employment.last_review_date from the most recent logged
 * review so the Compensation tab always reflects the Reviews tab.
 */
async function refreshLastReviewDate(
  supabase: DbClient,
  personId: string,
): Promise<void> {
  const { data } = await supabase
    .from("person_review")
    .select("review_date")
    .eq("person_id", personId)
    .not("review_date", "is", null)
    .order("review_date", { ascending: false })
    .limit(1);
  const latest = (data?.[0]?.review_date as string | undefined) ?? null;
  await supabase
    .from("person_employment")
    .update({ last_review_date: latest })
    .eq("person_id", personId);
}

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

  await refreshLastReviewDate(supabase, personId);

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
  await refreshLastReviewDate(supabase, personId);
  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Disciplinary actions
// ---------------------------------------------------------------------------

export async function saveDisciplinaryAction(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("action_id"));

  const patch = {
    person_id: personId,
    incident_date: str(formData.get("incident_date")),
    reported_by: str(formData.get("reported_by")),
    employee_position: str(formData.get("employee_position")),
    violation_type: str(formData.get("violation_type")),
    nature: str(formData.get("nature")),
    action_taken: str(formData.get("action_taken")),
    witnesses: str(formData.get("witnesses")),
  };

  const { error } = id
    ? await supabase
        .from("person_disciplinary_action")
        .update(patch)
        .eq("id", id)
    : await supabase.from("person_disciplinary_action").insert(patch);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/hr/${personId}`);
  return { ok: true };
}

export async function deleteDisciplinaryAction(
  personId: string,
  actionId: string,
): Promise<SaveResult> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_disciplinary_action")
    .delete()
    .eq("id", actionId);
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

// Permanently delete an employee record in its entirety. Admin/Owner only.
// Removes any stored documents from the bucket, then deletes the person row so
// the FK cascades clear employment, reviews, assets, scheduling, etc.
export async function deleteEmployee(personId: string): Promise<void> {
  const current = await getCurrentUser();
  if (!current || !isAdminRole(current.appUser.role)) {
    redirect(`/hr/${personId}`);
  }

  const admin = createAdminClient();

  // Purge any uploaded documents from storage first to avoid orphaned files.
  const { data: docs } = await admin
    .from("person_document")
    .select("storage_path")
    .eq("person_id", personId);
  const paths = (docs ?? [])
    .map((d) => (d as { storage_path: string | null }).storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove(paths);
  }

  const { error } = await admin.from("person").delete().eq("id", personId);
  if (error) {
    throw new Error(`Could not delete employee: ${error.message}`);
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "delete",
    entity: "person",
    entityId: personId,
    summary: "Deleted employee/roster record",
  });

  revalidatePath("/hr");
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
  redirect("/hr");
}
