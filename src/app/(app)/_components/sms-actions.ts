"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { canTextPerson } from "@/lib/sms/access";
import { blockReason, e164ToHouseFormat } from "@/lib/sms/rules";
import { loadSmsTarget, loadSmsThread, sendSmsToPerson, smsEnv, type SmsThreadMessage } from "@/lib/sms/send";

export type TextsView =
  | {
      ok: true;
      configured: false;
    }
  | {
      ok: true;
      configured: true;
      live: boolean;
      firstName: string | null;
      phone: string | null;
      phoneRaw: string | null;
      consentFromApplication: boolean;
      consentRecorded: { source: string; consented_at: string; recorded_by_name: string | null } | null;
      optedOut: boolean;
      blocked: string | null;
      messages: SmsThreadMessage[];
    }
  | { ok: false; error: string };

type Gate = { ok: true; current: CurrentUser } | { ok: false; error: string };

/** Signed in and allowed to text this person (status is read fresh, never trusted from the client). */
async function gate(personId: string): Promise<Gate> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in." };
  const { data } = await createAdminClient().from("person").select("status").eq("id", personId).maybeSingle();
  if (!data) return { ok: false, error: "That person no longer exists." };
  if (!canTextPerson(current.appUser, data.status as string)) {
    return { ok: false, error: "You don't have permission to text this person." };
  }
  return { ok: true, current };
}

function actorName(current: CurrentUser): string {
  return current.appUser.full_name ?? current.email.split("@")[0];
}

export async function loadTexts(personId: string): Promise<TextsView> {
  const g = await gate(personId);
  if (!g.ok) return g;
  const env = smsEnv();
  // Nothing below touches the sms_* tables until Twilio is configured.
  if (!env.configured) return { ok: true, configured: false };
  const admin = createAdminClient();
  const target = await loadSmsTarget(personId, admin);
  if (!target) return { ok: false, error: "That person no longer exists." };
  return {
    ok: true,
    configured: true,
    live: env.live,
    firstName: target.firstName,
    phone: target.phone ? e164ToHouseFormat(target.phone) : null,
    phoneRaw: target.phoneRaw,
    consentFromApplication: target.consentFromApplication,
    consentRecorded: target.consentRecorded,
    optedOut: target.optedOut,
    blocked: blockReason(target, env),
    messages: await loadSmsThread(target, admin),
  };
}

export async function sendText(personId: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate(personId);
  if (!g.ok) return g;
  const res = await sendSmsToPerson({
    personId,
    body,
    actor: { authId: g.current.authId, name: actorName(g.current) },
  });
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "create",
    entity: "sms_message",
    entityId: personId,
    summary: res.ok ? "Sent a text" : `Text not sent: ${res.error}`,
  });
  return res;
}

const CONSENT_SOURCES = new Set([
  "Agreed verbally",
  "Agreed in writing (text or email)",
  "Signed onboarding acknowledgement",
]);

export async function recordTextConsent(
  personId: string,
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate(personId);
  if (!g.ok) return g;
  if (!smsEnv().configured) return { ok: false, error: "Texting isn't set up yet." };
  if (!CONSENT_SOURCES.has(source)) return { ok: false, error: "Pick how they agreed." };
  const { error } = await createAdminClient().from("sms_consent").upsert(
    {
      person_id: personId,
      source,
      consented_at: new Date().toISOString(),
      recorded_by: g.current.authId,
      recorded_by_name: actorName(g.current),
    },
    { onConflict: "person_id" },
  );
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "update",
    entity: "sms_consent",
    entityId: personId,
    summary: `Recorded texting consent (${source})`,
  });
  return { ok: true };
}

export async function removeTextConsent(personId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate(personId);
  if (!g.ok) return g;
  if (!smsEnv().configured) return { ok: false, error: "Texting isn't set up yet." };
  const { error } = await createAdminClient().from("sms_consent").delete().eq("person_id", personId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: g.current.authId,
    actorEmail: g.current.email,
    action: "delete",
    entity: "sms_consent",
    entityId: personId,
    summary: "Removed recorded texting consent",
  });
  return { ok: true };
}
