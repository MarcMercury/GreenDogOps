"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import {
  parseFormFields,
  defaultEventFormFields,
  defaultCeFormFields,
  defaultPromoFormFields,
  defaultReferralFormFields,
  defaultRescueFormFields,
  QR_CODE_TYPES,
  QR_FORM_THEMES,
  QR_LEAD_STATUSES,
  type QrSubjectKind,
} from "@/lib/marketing/qr";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

async function requireMarketingEditor() {
  const current = await requireUser();
  if (!canEditModule(current.appUser, "marketing")) redirect("/");
  return current;
}

/**
 * Leads are triaged from the module that owns the code (Referral Clinics,
 * Rescues, CE, Non-Med Partners) as well as from QR Code Mgmt, so any of those
 * editors may update one.
 */
const LEAD_EDITOR_MODULES = [
  "marketing",
  "crm_referral",
  "crm_rescue",
  "crm_vendor",
  "crm_ce",
] as const;

async function requireLeadEditor() {
  const current = await requireUser();
  if (!LEAD_EDITOR_MODULES.some((m) => canEditModule(current.appUser, m))) {
    redirect("/");
  }
  return current;
}

function done(message: string): ActionResult {
  revalidatePath("/marketing/qr-codes");
  revalidatePath("/marketing/events");
  revalidatePath("/marketing");
  revalidatePath("/crm/ce");
  revalidatePath("/crm/referral");
  revalidatePath("/crm/rescue");
  return { ok: true, message };
}

const CODE_TYPES = new Set(QR_CODE_TYPES.map((t) => t.value as string));
const LEAD_STATUSES = new Set(QR_LEAD_STATUSES.map((s) => s.value));
const FORM_THEMES = new Set(QR_FORM_THEMES.map((t) => t.value));
const BANNER_BUCKET = "qr-form-banners";

/** A code can redirect a scanner anywhere, so only allow real web URLs. */
function webUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Forms
// ===========================================================================
export async function saveQrForm(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));

  let fields: ReturnType<typeof parseFormFields> = [];
  const raw = str(formData.get("fields_json"));
  if (raw) {
    try {
      fields = parseFormFields(JSON.parse(raw));
    } catch {
      return { ok: false, error: "Could not read the form questions." };
    }
  }

  const theme = str(formData.get("theme")) ?? "emerald";
  const patch = {
    name: str(formData.get("name")) ?? "Untitled form",
    headline: str(formData.get("headline")),
    intro: str(formData.get("intro")),
    success_message: str(formData.get("success_message")),
    collect_pet_name: bool(formData.get("collect_pet_name")),
    collect_zip: bool(formData.get("collect_zip")),
    fields,
    active: formData.has("active") ? bool(formData.get("active")) : true,
    // Branding is only edited in the Forms tab; the event dialog's editor posts
    // no theme/banner keys and must not blank out what was set there.
    ...(formData.has("theme")
      ? { theme: FORM_THEMES.has(theme) ? theme : "emerald" }
      : {}),
    ...(formData.has("banner_url")
      ? { banner_url: str(formData.get("banner_url")) }
      : {}),
  };

  const { error } = id
    ? await supabase.from("qr_form").update(patch).eq("id", id)
    : await supabase.from("qr_form").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Form updated." : "Form created.");
}

export async function deleteQrForm(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("qr_form").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Form deleted.");
}

const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Upload a header image for a capture form. The bucket is public because the
 * banner renders for unauthenticated scanners — so only real image types are
 * accepted and the stored name is generated, never taken from the upload.
 */
export async function uploadQrFormBanner(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult & { url?: string }> {
  await requireMarketingEditor();

  const file = formData.get("banner");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose an image." };
  }
  if (file.size > BANNER_MAX_BYTES) {
    return { ok: false, error: "Image exceeds the 5 MB limit." };
  }
  if (!BANNER_TYPES.has(file.type)) {
    return { ok: false, error: "Use a PNG, JPEG, WEBP or GIF image." };
  }

  const admin = createAdminClient();
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(BANNER_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: upErr.message };

  const { data } = admin.storage.from(BANNER_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl, message: "Banner uploaded." };
}

// ===========================================================================
// QR codes
// ===========================================================================
export async function saveQrCode(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const codeType = str(formData.get("code_type")) ?? "event";
  const rawTarget = str(formData.get("target_url"));
  const targetUrl = webUrl(rawTarget);
  if (rawTarget && !targetUrl) {
    return { ok: false, error: "The redirect URL must start with http:// or https://" };
  }

  const patch = {
    label: str(formData.get("label")) ?? "Untitled code",
    code_type: CODE_TYPES.has(codeType) ? codeType : "other",
    event_id: str(formData.get("event_id")),
    ce_event_id: str(formData.get("ce_event_id")),
    promotion_id: str(formData.get("promotion_id")),
    org_id: str(formData.get("org_id")),
    referral_partner_id: str(formData.get("referral_partner_id")),
    form_id: str(formData.get("form_id")),
    target_url: targetUrl,
    notes: str(formData.get("notes")),
    active: formData.has("active") ? bool(formData.get("active")) : true,
  };

  const { error } = id
    ? await supabase.from("qr_code").update(patch).eq("id", id)
    : await supabase.from("qr_code").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "QR code updated." : "QR code created.");
}

export async function deleteQrCode(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("qr_code").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("QR code deleted.");
}

/** "Manage code" dialog: point an already-printed code at a capture form. */
export async function assignQrCodeForm(
  id: string,
  formId: string | null,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("qr_code")
    .update({ form_id: formId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done(formId ? "Form assigned to this code." : "Form removed from this code.");
}

export async function setQrCodeActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("qr_code").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done(active ? "QR code activated." : "QR code deactivated.");
}

/**
 * One-click "give this record a QR code": creates a starter capture form and a
 * code pointing at it, so nobody has to visit QR Code Mgmt to get something
 * printable. The record itself is still edited in its own module — this only
 * adds its code.
 */
const SUBJECT_SPECS: Record<
  QrSubjectKind,
  {
    codeType: string;
    column: string;
    formSuffix: string;
    collectPetName: boolean;
    headline: (name: string) => string;
    intro: (name: string) => string;
    fields: () => ReturnType<typeof defaultEventFormFields>;
  }
> = {
  event: {
    codeType: "event",
    column: "event_id",
    formSuffix: "sign-up",
    collectPetName: true,
    headline: () => "Welcome from Green Dog!",
    intro: (n) => `Leave your info and we'll be in touch about ${n}.`,
    fields: defaultEventFormFields,
  },
  ce: {
    codeType: "ce",
    column: "ce_event_id",
    formSuffix: "check-in",
    collectPetName: false,
    headline: (n) => n,
    intro: (n) => `Check in for ${n} and we'll send your CE certificate.`,
    fields: defaultCeFormFields,
  },
  promo: {
    codeType: "promo",
    column: "promotion_id",
    formSuffix: "offer",
    collectPetName: true,
    headline: (n) => n,
    intro: (n) => `Claim ${n} — leave your details and we'll set it up.`,
    fields: defaultPromoFormFields,
  },
  referral: {
    codeType: "referral",
    column: "referral_partner_id",
    formSuffix: "referral",
    collectPetName: true,
    headline: () => "Referred to Green Dog Dental",
    intro: (n) => `${n} referred you to us. Leave your details and we'll reach out.`,
    fields: defaultReferralFormFields,
  },
  rescue: {
    codeType: "rescue",
    column: "org_id",
    formSuffix: "adopter welcome",
    collectPetName: true,
    headline: () => "Welcome, new pet parent!",
    intro: (n) => `Adopted through ${n}? Green Dog Dental would love to meet your pet.`,
    fields: defaultRescueFormFields,
  },
};

export async function createQrCodeFor(
  kind: QrSubjectKind,
  subjectId: string,
  subjectName: string,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const spec = SUBJECT_SPECS[kind];
  if (!spec) return { ok: false, error: "Unknown record type." };

  const { data: form, error: formErr } = await supabase
    .from("qr_form")
    .insert({
      name: `${subjectName} — ${spec.formSuffix}`,
      headline: spec.headline(subjectName),
      intro: spec.intro(subjectName),
      success_message: "Thanks! We'll be in touch soon.",
      collect_pet_name: spec.collectPetName,
      collect_zip: false,
      fields: spec.fields(),
      active: true,
    })
    .select("id")
    .single();
  if (formErr) return { ok: false, error: formErr.message };

  const { error: codeErr } = await supabase.from("qr_code").insert({
    label: subjectName,
    code_type: spec.codeType,
    [spec.column]: subjectId,
    form_id: (form as { id: string }).id,
    active: true,
  });
  if (codeErr) return { ok: false, error: codeErr.message };
  return done("QR code created.");
}

// ===========================================================================
// Leads
// ===========================================================================
export async function setQrLeadStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  await requireLeadEditor();
  if (!LEAD_STATUSES.has(status)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.from("qr_lead").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Lead updated.");
}

export async function saveQrLeadNotes(
  id: string,
  notes: string,
): Promise<ActionResult> {
  await requireLeadEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("qr_lead")
    .update({ notes: notes.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Lead updated.");
}

export async function deleteQrLead(id: string): Promise<ActionResult> {
  await requireLeadEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("qr_lead").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Lead deleted.");
}
