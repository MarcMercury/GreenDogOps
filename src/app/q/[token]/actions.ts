"use server";

import { allowPublicSubmission, TOO_MANY_MESSAGE } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { type CaptureReceipt, parseFormFields, readFormAnswers } from "@/lib/marketing/qr";

export type QrLeadResult =
  | { ok: true; receipt?: CaptureReceipt }
  | { ok: false; error: string };

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
  referral_partner_id: string | null;
  influencer_id: string | null;
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
  // Event and storefront QR traffic often shares one venue IP, so this is generous.
  if (!(await allowPublicSubmission("qr", 60))) return { ok: false, error: TOO_MANY_MESSAGE };
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
    .select(
      "id, event_id, ce_event_id, org_id, referral_partner_id, influencer_id, active, qr_form(fields, collect_pet_name, collect_zip)",
    )
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

  const { data: lead, error: insErr } = await admin
    .from("qr_lead")
    .insert({
      qr_code_id: code.id,
      event_id: code.event_id,
      ce_event_id: code.ce_event_id,
      org_id: code.org_id,
      referral_partner_id: code.referral_partner_id,
      influencer_id: code.influencer_id,
      full_name: fullName,
      email,
      phone,
      pet_name: formRow?.collect_pet_name === false ? null : petName,
      zip: formRow && !formRow.collect_zip ? null : zip,
      answers: read.answers,
      source: "qr_scan",
      status: "new",
    })
    .select("confirmation_code, created_at")
    .single();
  if (insErr) return { ok: false, error: "Could not submit. Please try again." };

  const row = lead as { confirmation_code: string; created_at: string };
  return {
    ok: true,
    receipt: {
      confirmationCode: row.confirmation_code,
      fullName,
      submittedAt: row.created_at,
    },
  };
}
