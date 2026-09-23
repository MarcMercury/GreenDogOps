"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import {
  parseFormFields,
  defaultEventFormFields,
  defaultCeFormFields,
  QR_CODE_TYPES,
  QR_LEAD_STATUSES,
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

function done(message: string): ActionResult {
  revalidatePath("/marketing/qr-codes");
  revalidatePath("/marketing/events");
  revalidatePath("/marketing");
  revalidatePath("/crm/ce");
  return { ok: true, message };
}

const CODE_TYPES = new Set(QR_CODE_TYPES.map((t) => t.value as string));
const LEAD_STATUSES = new Set(QR_LEAD_STATUSES.map((s) => s.value));

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

  const patch = {
    name: str(formData.get("name")) ?? "Untitled form",
    headline: str(formData.get("headline")),
    intro: str(formData.get("intro")),
    success_message: str(formData.get("success_message")),
    collect_pet_name: bool(formData.get("collect_pet_name")),
    collect_zip: bool(formData.get("collect_zip")),
    fields,
    active: formData.has("active") ? bool(formData.get("active")) : true,
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
 * One-click "give this event a QR code": creates a starter capture form and a
 * code pointing at it, so nobody has to visit QR Code Mgmt to get something
 * printable. Works for both marketing events and CE courses — a CE course is
 * still built in the CE module, this only adds its code.
 */
export async function createQrCodeFor(
  kind: "event" | "ce",
  subjectId: string,
  subjectName: string,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const isCe = kind === "ce";

  const { data: form, error: formErr } = await supabase
    .from("qr_form")
    .insert({
      name: `${subjectName} — sign-up`,
      headline: isCe ? subjectName : `Welcome from Green Dog!`,
      intro: isCe
        ? `Check in for ${subjectName} and we'll send your CE certificate.`
        : `Leave your info and we'll be in touch about ${subjectName}.`,
      success_message: "Thanks! We'll be in touch soon.",
      collect_pet_name: !isCe,
      collect_zip: false,
      fields: isCe ? defaultCeFormFields() : defaultEventFormFields(),
      active: true,
    })
    .select("id")
    .single();
  if (formErr) return { ok: false, error: formErr.message };

  const { error: codeErr } = await supabase.from("qr_code").insert({
    label: subjectName,
    code_type: isCe ? "ce" : "event",
    event_id: isCe ? null : subjectId,
    ce_event_id: isCe ? subjectId : null,
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
  await requireMarketingEditor();
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
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("qr_lead")
    .update({ notes: notes.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Lead updated.");
}

export async function deleteQrLead(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("qr_lead").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Lead deleted.");
}
