"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneNumber } from "@/lib/shared/phone";
import { parseFormFields, readFormAnswers } from "@/lib/marketing/qr";

export type LeadResult = { ok: true } | { ok: false; error: string };

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// This action is reachable by anyone holding a partner's printed QR code, so
// cap both the size of a single submission and how fast one partner can accept
// them. A busy retail counter sees a handful of scans an hour; 40 per 10
// minutes is far above real use but stops a script from filling the CRM.
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_PET_LENGTH = 120;
const BURST_WINDOW_MINUTES = 10;
const BURST_MAX_LEADS = 40;

type FormEmbed = { fields: unknown; active: boolean };

/**
 * PUBLIC action — called from the unauthenticated retail lead form reached by
 * scanning a Non-Med Partner's QR code. Uses the service-role client (bypasses
 * RLS) so it must resolve the partner from the opaque token only, validate its
 * inputs strictly, and write nothing but a crm_retail_lead row.
 */
export async function submitRetailLead(
  token: string,
  _prev: LeadResult | null,
  formData: FormData,
): Promise<LeadResult> {
  const fullName = clean(formData.get("full_name"));
  const email = clean(formData.get("email"));
  const phone = formatPhoneNumber(clean(formData.get("phone")));
  const petName = clean(formData.get("pet_name"));
  const zip = clean(formData.get("zip"))?.slice(0, 16) ?? null;

  if (!fullName) return { ok: false, error: "Please enter your name." };
  if (fullName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Please enter a shorter name." };
  }
  if (petName && petName.length > MAX_PET_LENGTH) {
    return { ok: false, error: "Please enter a shorter pet name." };
  }
  if (!email && !phone) {
    return { ok: false, error: "Please enter an email or phone number." };
  }
  if (email && (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const admin = createAdminClient();

  const { data: orgRow, error: orgErr } = await admin
    .from("crm_organization")
    .select("id")
    .eq("qr_token", token)
    .maybeSingle();
  if (orgErr) return { ok: false, error: "Something went wrong. Please try again." };
  if (!orgRow) return { ok: false, error: "This code is no longer active." };
  const orgId = (orgRow as { id: string }).id;

  // Migration 0208 gave every partner a qr_code row keyed by the same token, so
  // a form assigned in QR Code Mgmt decides which custom questions were asked.
  const { data: codeRow } = await admin
    .from("qr_code")
    .select("qr_form(fields, active)")
    .eq("token", token)
    .maybeSingle();
  const embed = (codeRow as { qr_form: FormEmbed | FormEmbed[] | null } | null)?.qr_form;
  const formRow = Array.isArray(embed) ? embed[0] : embed;
  const read = readFormAnswers(
    formRow?.active ? parseFormFields(formRow.fields) : [],
    formData,
  );
  if ("error" in read) return { ok: false, error: read.error };

  const windowStart = new Date(Date.now() - BURST_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recent } = await admin
    .from("crm_retail_lead")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("created_at", windowStart);
  if ((recent ?? 0) >= BURST_MAX_LEADS) {
    return {
      ok: false,
      error: "We're receiving a lot of submissions right now. Please try again in a few minutes.",
    };
  }

  const { error: insErr } = await admin.from("crm_retail_lead").insert({
    org_id: orgId,
    full_name: fullName,
    email,
    phone,
    pet_name: petName,
    zip,
    answers: read.answers,
    source: "qr_scan",
    status: "new",
  });
  if (insErr) return { ok: false, error: "Could not submit. Please try again." };

  return { ok: true };
}
