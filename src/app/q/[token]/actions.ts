"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { parseFormFields, readFormAnswers } from "@/lib/marketing/qr";

export type QrLeadResult = { ok: true } | { ok: false; error: string };

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Reachable by anyone holding a printed code, so cap both the size of one
// submission and how fast a single code can accept them. A busy event booth
// sees a few scans a minute; 60 per 10 minutes is far above real use but stops
// a script from filling the leads table.
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_SHORT_LENGTH = 120;
const BURST_WINDOW_MINUTES = 10;
const BURST_MAX_LEADS = 60;

type CodeRow = {
  id: string;
  event_id: string | null;
  ce_event_id: string | null;
  org_id: string | null;
  active: boolean;
  qr_form: { fields: unknown; collect_pet_name: boolean; collect_zip: boolean } | null;
};

/**
 * PUBLIC action — called from the unauthenticated /q/<token> capture form.
 * Uses the service-role client (bypasses RLS), so it must resolve the code
 * from the opaque token only, validate every input, and write nothing but a
 * qr_lead row.
 */
export async function submitQrLead(
  token: string,
  _prev: QrLeadResult | null,
  formData: FormData,
): Promise<QrLeadResult> {
  const fullName = clean(formData.get("full_name"));
  const email = clean(formData.get("email"));
  const phone = formatPhoneNumber(clean(formData.get("phone")));
  const petName = clean(formData.get("pet_name"));
  const zip = clean(formData.get("zip"));

  if (!fullName) return { ok: false, error: "Please enter your name." };
  if (fullName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Please enter a shorter name." };
  }
  if (petName && petName.length > MAX_SHORT_LENGTH) {
    return { ok: false, error: "Please enter a shorter pet name." };
  }
  if (zip && zip.length > 12) {
    return { ok: false, error: "Please enter a valid ZIP code." };
  }
  if (!email && !phone) {
    return { ok: false, error: "Please enter an email or phone number." };
  }
  if (email && (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const admin = createAdminClient();

  const { data, error: codeErr } = await admin
    .from("qr_code")
    .select("id, event_id, ce_event_id, org_id, active, qr_form(fields, collect_pet_name, collect_zip)")
    .eq("token", token)
    .maybeSingle();
  if (codeErr) return { ok: false, error: "Something went wrong. Please try again." };
  const code = data as CodeRow | null;
  if (!code || !code.active) return { ok: false, error: "This code is no longer active." };

  // Supabase infers a to-one embed as an array in some shapes; normalize.
  const formRow = Array.isArray(code.qr_form) ? code.qr_form[0] : code.qr_form;
  const read = readFormAnswers(parseFormFields(formRow?.fields), formData);
  if ("error" in read) return { ok: false, error: read.error };

  const windowStart = new Date(Date.now() - BURST_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recent } = await admin
    .from("qr_lead")
    .select("id", { count: "exact", head: true })
    .eq("qr_code_id", code.id)
    .gte("created_at", windowStart);
  if ((recent ?? 0) >= BURST_MAX_LEADS) {
    return {
      ok: false,
      error: "We're receiving a lot of submissions right now. Please try again in a few minutes.",
    };
  }

  const { error: insErr } = await admin.from("qr_lead").insert({
    qr_code_id: code.id,
    event_id: code.event_id,
    ce_event_id: code.ce_event_id,
    org_id: code.org_id,
    full_name: fullName,
    email,
    phone,
    pet_name: formRow?.collect_pet_name === false ? null : petName,
    zip: formRow?.collect_zip ? zip : null,
    answers: read.answers,
    source: "qr_scan",
    status: "new",
  });
  if (insErr) return { ok: false, error: "Could not submit. Please try again." };

  return { ok: true };
}
