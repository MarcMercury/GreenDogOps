import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/ats/slack-notify";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSmsConfigured, sendTwilioMessage } from "./twilio";
import {
  applicationConsent,
  blockReason,
  composeOutbound,
  hasSmsConsent,
  normalizeStatus,
  parseTestNumbers,
  statusesReplaceableBy,
  toE164,
  validateSmsBody,
  type SmsEnv,
  type SmsTargetFacts,
} from "./rules";

type Admin = ReturnType<typeof createAdminClient>;

/** Texts per staff member per hour — a guard against runaway sends. */
const SENDS_PER_HOUR = 60;

export function smsEnv(): SmsEnv {
  return {
    configured: isSmsConfigured(),
    live: process.env.SMS_LIVE?.trim().toLowerCase() === "true",
    testNumbers: parseTestNumbers(process.env.SMS_TEST_NUMBERS),
  };
}

export interface SmsTarget extends SmsTargetFacts {
  personId: string;
  firstName: string | null;
  consentFromApplication: boolean;
  consentRecorded: { source: string; consented_at: string; recorded_by_name: string | null } | null;
}

export async function loadSmsTarget(personId: string, admin: Admin = createAdminClient()): Promise<SmsTarget | null> {
  const { data } = await admin
    .from("person")
    .select("id, status, first_name, last_name, full_name, phone_mobile, person_recruiting ( application )")
    .eq("id", personId)
    .maybeSingle();
  if (!data) return null;
  const p = data as {
    id: string;
    status: string | null;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    phone_mobile: string | null;
    person_recruiting: { application: { answers?: Record<string, unknown> } | null } | { application: unknown }[] | null;
  };
  const rec = Array.isArray(p.person_recruiting) ? p.person_recruiting[0] : p.person_recruiting;
  const answer = (rec?.application as { answers?: Record<string, unknown> } | null)?.answers?.sms_consent;
  const phone = toE164(p.phone_mobile);

  const [{ data: consent }, { data: optOut }] = await Promise.all([
    admin.from("sms_consent").select("source, consented_at, recorded_by_name").eq("person_id", personId).maybeSingle(),
    phone
      ? admin.from("sms_opt_out").select("phone").eq("phone", phone).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const consentRecorded = (consent as SmsTarget["consentRecorded"]) ?? null;
  const consentFromApplication = applicationConsent(p.status, answer);

  return {
    personId: p.id,
    status: p.status,
    firstName: p.first_name,
    name: p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "this person",
    phoneRaw: p.phone_mobile,
    phone,
    consentFromApplication,
    consentRecorded,
    hasConsent: hasSmsConsent({ status: p.status, applicationAnswer: answer, consentRecorded: Boolean(consentRecorded) }),
    optedOut: Boolean(optOut),
  };
}

export interface SmsThreadMessage {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  status: string;
  error_message: string | null;
  sent_by_name: string | null;
  created_at: string;
}

const THREAD_COLUMNS = "id, direction, body, status, error_message, sent_by_name, created_at";

/** The person's texts, plus unmatched replies from their number. Oldest first. */
export async function loadSmsThread(target: SmsTarget, admin: Admin = createAdminClient()): Promise<SmsThreadMessage[]> {
  const [mine, loose] = await Promise.all([
    admin.from("sms_message").select(THREAD_COLUMNS).eq("person_id", target.personId).order("created_at", { ascending: false }).limit(200),
    target.phone
      ? admin.from("sms_message").select(THREAD_COLUMNS).is("person_id", null).eq("phone", target.phone).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const all = [...((mine.data ?? []) as SmsThreadMessage[]), ...((loose.data ?? []) as SmsThreadMessage[])];
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export type SmsSendResult = { ok: true } | { ok: false; error: string };

/**
 * Send one text to a person. Every check runs server-side on fresh data; the
 * message is logged before Twilio is called so a crash never loses a record.
 * The caller has already checked the user's permission (canTextPerson).
 */
export async function sendSmsToPerson(input: {
  personId: string;
  body: string;
  actor: { authId: string; name: string };
}): Promise<SmsSendResult> {
  const invalid = validateSmsBody(input.body);
  if (invalid) return { ok: false, error: invalid };

  const env = smsEnv();
  if (!env.configured) return { ok: false, error: "Texting isn't set up yet." };
  const admin = createAdminClient();
  const target = await loadSmsTarget(input.personId, admin);
  if (!target) return { ok: false, error: "That person no longer exists." };
  const blocked = blockReason(target, env);
  if (blocked) return { ok: false, error: blocked };
  const to = target.phone!;

  if (!(await rateLimit(`sms:${input.actor.authId}`, SENDS_PER_HOUR, 3600))) {
    return { ok: false, error: `You've sent ${SENDS_PER_HOUR} texts in the last hour. Try again later.` };
  }

  const { count: priorCount } = await admin
    .from("sms_message")
    .select("id", { count: "exact", head: true })
    .eq("phone", to)
    .eq("direction", "outbound")
    .not("status", "in", "(failed,undelivered)");
  const text = composeOutbound(input.body, { firstToNumber: (priorCount ?? 0) === 0 });

  const { data: row, error: insErr } = await admin
    .from("sms_message")
    .insert({
      person_id: target.personId,
      direction: "outbound",
      phone: to,
      body: text,
      status: "queued",
      sent_by: input.actor.authId,
      sent_by_name: input.actor.name,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: `Couldn't log the text: ${insErr?.message ?? "unknown error"}` };

  const messageId = (row as { id: string }).id;
  // The row id rides on the callback URL, so a status that arrives before the
  // SID is saved below still finds its message.
  const sent = await sendTwilioMessage({
    to,
    body: text,
    statusCallback: `${appBaseUrl()}/api/sms/status?m=${messageId}`,
  });
  if (!sent.ok) {
    await admin
      .from("sms_message")
      .update({ status: "failed", error_code: sent.code ?? null, error_message: sent.error })
      .eq("id", messageId);
    return { ok: false, error: sent.error };
  }
  await admin.from("sms_message").update({ twilio_sid: sent.sid }).eq("id", messageId).is("twilio_sid", null);
  const status = normalizeStatus(sent.status);
  await admin
    .from("sms_message")
    .update({ status })
    .eq("id", messageId)
    .in("status", statusesReplaceableBy(status));
  return { ok: true };
}
