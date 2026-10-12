"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/session";
import { allowPublicSubmission, requestMeta, TOO_MANY_MESSAGE } from "@/lib/security/rate-limit";
import { matchOptInPeople, type OptInCandidate } from "@/lib/sms/opt-in";
import { toE164 } from "@/lib/sms/rules";

export type OptInResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const OPT_IN_SOURCE = "Opted in at greendogops.com/texts";

function str(v: FormDataEntryValue | null, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Public, voluntary opt-in to Green Dog Dental Recruiting & HR texts. Records
 * consent for the matching candidate/employee profile(s). The reply is the
 * same whether or not the number is on file, so the page can't be used to
 * look people up.
 */
export async function optInToTexts(fd: FormData): Promise<OptInResult> {
  if (!(await allowPublicSubmission("texts", 10))) return { ok: false, error: TOO_MANY_MESSAGE };
  if (str(fd.get("website"))) return { ok: true };

  const firstName = str(fd.get("first_name"));
  const lastName = str(fd.get("last_name"));
  const phone = toE164(str(fd.get("phone"), 40));
  const agreed = str(fd.get("agree")) === "yes";

  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.first_name = "Enter your first name.";
  if (!lastName) fieldErrors.last_name = "Enter your last name.";
  if (!phone) fieldErrors.phone = "Enter a US mobile number.";
  if (!agreed) fieldErrors.agree = "Check the box to sign up for texts.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("person")
    .select("id, status, last_name, phone_mobile")
    .in("status", ["prospect", "applicant", "employee", "contractor"])
    .ilike("phone_mobile", `%${phone!.slice(-4)}%`)
    .limit(200);
  if (error) {
    console.error("[texts] opt-in lookup failed:", error.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const ids = matchOptInPeople((data ?? []) as OptInCandidate[], { lastName, phone: phone! });
  if (ids.length === 0) return { ok: true };

  const consentedAt = new Date().toISOString();
  const { error: upErr } = await admin.from("sms_consent").upsert(
    ids.map((person_id) => ({
      person_id,
      source: OPT_IN_SOURCE,
      consented_at: consentedAt,
      recorded_by: null,
      recorded_by_name: null,
    })),
    { onConflict: "person_id" },
  );
  if (upErr) {
    console.error("[texts] opt-in save failed:", upErr.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const meta = await requestMeta();
  for (const id of ids) {
    await recordAudit({
      actorId: null,
      actorEmail: null,
      action: "create",
      entity: "sms_consent",
      entityId: id,
      summary: `${firstName} ${lastName} opted in to texts at /texts`,
      metadata: { ip: meta.ip, user_agent: meta.userAgent, consented_at: consentedAt },
    });
  }
  return { ok: true };
}
