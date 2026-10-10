// ---------------------------------------------------------------------------
// Texting (SMS) rules — the pure parts, so they're unit-tested: phone number
// normalisation, consent, opt-out keywords, quiet hours, the go-live gate and
// the compliance wording added to outgoing texts. Twilio I/O lives in
// ./twilio.ts and ./send.ts.
// ---------------------------------------------------------------------------

import { zonedParts } from "../ats/scheduling";

export const SMS_TIMEZONE = "America/Los_Angeles";
/** Texts may go out from 8:00 AM until 9:00 PM Pacific. */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;
/** Four SMS segments; longer messages cost more and get split badly. */
export const MAX_SMS_LENGTH = 640;
export const OPT_OUT_FOOTER = "Reply STOP to opt out.";

/**
 * A US/Canada number as E.164 (+1XXXXXXXXXX), or null. Our Twilio campaign is
 * US-only, so international numbers are rejected rather than guessed at.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Drop "x123" / "ext 123" style extensions before reading digits.
  const base = String(raw).replace(/\s*(?:ext\.?|extension|x)\s*\d{1,6}\s*$/i, "");
  if (/^\s*(?:\+|00|011)(?!1)/.test(base)) return null;
  let digits = base.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** +13105551234 → "(310) 555-1234", the house format stored on person. */
export function e164ToHouseFormat(e164: string): string | null {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
}

export type SmsKeyword = "stop" | "start" | "help" | null;

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

/** Carrier opt-out / opt-in / help keywords (whole message, any case). */
export function classifyKeyword(body: string | null | undefined): SmsKeyword {
  const word = (body ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

export function isQuietHours(now: Date, timeZone = SMS_TIMEZONE): boolean {
  const hour = Number(zonedParts(now, timeZone).time.slice(0, 2));
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Who can be texted at all, by person.status. Former employees can't. */
export function isTextableStatus(status: string | null | undefined): boolean {
  return status === "prospect" || status === "applicant" || status === "employee" || status === "contractor";
}

/**
 * The application's "I agree to receive texts … about my application" box.
 * It only covers recruiting, so it counts for candidates, not after hire.
 */
export function applicationConsent(status: string | null | undefined, applicationAnswer: unknown): boolean {
  if (status !== "prospect" && status !== "applicant") return false;
  return typeof applicationAnswer === "string" && applicationAnswer.trim().toLowerCase() === "yes";
}

/** Consent on file: application consent (candidates) or recorded by staff (sms_consent row). */
export function hasSmsConsent(input: {
  status: string | null | undefined;
  applicationAnswer?: unknown;
  consentRecorded: boolean;
}): boolean {
  return input.consentRecorded || applicationConsent(input.status, input.applicationAnswer);
}

/** SMS_TEST_NUMBERS="(310) 555-1234, +13105559876" → E.164 set. */
export function parseTestNumbers(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,;\n]/)
      .map((s) => toE164(s))
      .filter((s): s is string => Boolean(s)),
  );
}

/**
 * Until SMS_LIVE=true, texts only go to the numbers in SMS_TEST_NUMBERS so the
 * integration can be tested end to end without texting real people.
 */
export function passesGoLiveGate(e164: string, env: { live: boolean; testNumbers: Set<string> }): boolean {
  return env.live || env.testNumbers.has(e164);
}

/**
 * The text as sent: identifies Green Dog, and the first text to a number says
 * how to opt out (carrier A2P rules).
 */
export function composeOutbound(body: string, opts: { firstToNumber: boolean }): string {
  const trimmed = body.trim();
  // Matches the registered campaign's sample messages (brand: Mobile Vet Services, LLC dba Green Dog Dental).
  const branded = /^green\s*dog\b/i.test(trimmed) ? trimmed : `Green Dog Dental: ${trimmed}`;
  return opts.firstToNumber ? `${branded}\n${OPT_OUT_FOOTER}` : branded;
}

export function validateSmsBody(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return "Write a message first.";
  if (trimmed.length > MAX_SMS_LENGTH) return `Keep texts under ${MAX_SMS_LENGTH} characters.`;
  return null;
}

export interface SmsEnv {
  configured: boolean;
  live: boolean;
  testNumbers: Set<string>;
}

/** What blockReason needs to know about the person being texted. */
export interface SmsTargetFacts {
  status: string | null;
  name: string;
  phoneRaw: string | null;
  /** E.164, or null when phone_mobile isn't a usable US number. */
  phone: string | null;
  hasConsent: boolean;
  optedOut: boolean;
}

/** Why this person can't be texted right now, or null when they can. */
export function blockReason(target: SmsTargetFacts, env: SmsEnv, now = new Date()): string | null {
  if (!env.configured) return "Texting isn't set up yet. An admin needs to add the Twilio credentials.";
  if (!isTextableStatus(target.status)) return "Former employees can't be texted from Ops.";
  if (!target.phoneRaw) return "No mobile number on file.";
  if (!target.phone) return `"${target.phoneRaw}" isn't a US mobile number Ops can text.`;
  if (target.optedOut) return `${target.name} replied STOP, so Ops won't text them unless they reply START.`;
  if (!target.hasConsent) return `No texting consent on file for ${target.name}. Record it below once they've agreed.`;
  if (!passesGoLiveGate(target.phone, env)) {
    return "Texting is in test mode: only the numbers in SMS_TEST_NUMBERS can be texted until SMS_LIVE is turned on.";
  }
  if (isQuietHours(now)) {
    return `Texts can only go out between ${QUIET_END_HOUR} AM and ${QUIET_START_HOUR - 12} PM Pacific.`;
  }
  return null;
}

const STATUSES = new Set(["queued", "sending", "sent", "delivered", "undelivered", "failed", "received"]);

/** Twilio also reports accepted/scheduled/read/canceled; map onto our set. */
export function normalizeStatus(s: string | null | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (STATUSES.has(v)) return v;
  if (v === "read") return "delivered";
  if (v === "canceled") return "failed";
  return "queued";
}

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
  received: 3,
};

/** Twilio status callbacks can arrive out of order; only ever move forward. */
export function shouldApplyStatus(current: string, next: string): boolean {
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0);
}

/**
 * The stored statuses that `next` may replace — used as a WHERE condition so
 * concurrent callbacks can't overwrite a later status with an earlier one.
 */
export function statusesReplaceableBy(next: string): string[] {
  return Object.keys(STATUS_RANK).filter((s) => shouldApplyStatus(s, next));
}
