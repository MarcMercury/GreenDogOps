import { WORK_TZ } from "../worklist/dates";
import { MEAL_WAIVER_KINDS, MEAL_WAIVER_LABELS, type MealWaiverKind } from "../timeclock/meal-waiver";

/**
 * Employee acknowledgements shown read-only on the HR profile's Onboarding tab:
 * the self-service text-message opt-in (/texts or /apply → `sms_consent`) and
 * the My Time privacy notice ("I have read this notice" → `time_clock_notice_ack`).
 *
 * The employee records these themselves, so HR can't edit them. The text
 * opt-in is voluntary and must never count toward onboarding progress:
 * carriers rejected the campaign when consent looked like an onboarding
 * requirement (docs/agent/architecture.md).
 */

export type AcknowledgementState = "done" | "attention" | "none";

export interface AcknowledgementRow {
  key: "sms_opt_in" | "time_clock_notice" | `meal_waiver_${MealWaiverKind}`;
  label: string;
  state: AcknowledgementState;
  status: string;
  /** "Oct 13, 2026 at 2:31 PM PDT", or null when nothing was recorded. */
  at: string | null;
  detail: string | null;
}

export interface SmsConsentRecord {
  source: string;
  consented_at: string;
}

export interface SmsOptOutRecord {
  opted_out_at: string;
}

export interface WaiverAckRecord {
  kind: MealWaiverKind;
  version_no: number;
  signed_at: string;
  revoked_at: string | null;
}

export interface NoticeAckRecord {
  notice_version: string;
  acknowledged_at: string;
}

/** Date and time in the clinics' time zone, e.g. "Oct 13, 2026 at 2:31 PM PDT". */
export function formatAckTimestamp(iso: string | null | undefined, timeZone = WORK_TZ): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date} at ${time}`;
}

function smsRow(consent: SmsConsentRecord | null, optOut: SmsOptOutRecord | null): AcknowledgementRow {
  const base = { key: "sms_opt_in" as const, label: "Text messages (Recruiting & HR)" };
  // STOP is keyed by phone number and blocks every text until START, so it wins
  // over an opt-in regardless of which came first.
  if (optOut) {
    const optedIn = formatAckTimestamp(consent?.consented_at);
    return {
      ...base,
      state: "attention",
      status: "Opted out (replied STOP)",
      at: formatAckTimestamp(optOut.opted_out_at),
      detail: optedIn ? `Had opted in ${optedIn}` : null,
    };
  }
  if (consent) {
    return {
      ...base,
      state: "done",
      status: "Opted in",
      at: formatAckTimestamp(consent.consented_at),
      detail: consent.source || null,
    };
  }
  return {
    ...base,
    state: "none",
    status: "Not opted in",
    at: null,
    detail: "Voluntary — the employee opts in at greendogops.com/texts.",
  };
}

function noticeRow(acks: NoticeAckRecord[], currentVersion: string): AcknowledgementRow {
  const base = { key: "time_clock_notice" as const, label: "My Time — Time clock privacy notice" };
  const current = acks.find((a) => a.notice_version === currentVersion);
  if (current) {
    return {
      ...base,
      state: "done",
      status: "Read",
      at: formatAckTimestamp(current.acknowledged_at),
      detail: `Version ${currentVersion}`,
    };
  }
  const latest = [...acks].sort((a, b) => b.acknowledged_at.localeCompare(a.acknowledged_at))[0];
  if (latest) {
    return {
      ...base,
      state: "attention",
      status: "Read an earlier version",
      at: formatAckTimestamp(latest.acknowledged_at),
      detail: `Read version ${latest.notice_version}; the current version (${currentVersion}) is asked before the next punch.`,
    };
  }
  return {
    ...base,
    state: "none",
    status: "Not yet read",
    at: null,
    detail: "Asked in My Time before the first time-clock punch.",
  };
}

function waiverRow(kind: MealWaiverKind, records: WaiverAckRecord[]): AcknowledgementRow {
  const base = { key: `meal_waiver_${kind}` as const, label: MEAL_WAIVER_LABELS[kind] };
  const mine = records.filter((r) => r.kind === kind).sort((a, b) => b.signed_at.localeCompare(a.signed_at));
  const active = mine.find((r) => r.revoked_at === null);
  if (active) {
    return { ...base, state: "done", status: "Signed", at: formatAckTimestamp(active.signed_at), detail: `Version ${active.version_no} · the employee can revoke it in My Time` };
  }
  const last = mine[0];
  if (last) {
    return {
      ...base,
      state: "attention",
      status: "Revoked",
      at: formatAckTimestamp(last.revoked_at),
      detail: `Had signed ${formatAckTimestamp(last.signed_at)}; this meal period applies again.`,
    };
  }
  return { ...base, state: "none", status: "Not signed", at: null, detail: "Voluntary — offered in My Time to non-exempt staff." };
}

/**
 * The rows in display order. `sms` is omitted (undefined) when the viewer may
 * not see texting data for this person.
 */
export function buildAcknowledgements(input: {
  sms?: { consent: SmsConsentRecord | null; optOut: SmsOptOutRecord | null };
  noticeAcks: NoticeAckRecord[];
  currentNoticeVersion: string;
  /** Meal-period waivers (0242); omitted when not loaded. */
  waivers?: WaiverAckRecord[];
}): AcknowledgementRow[] {
  const rows: AcknowledgementRow[] = [];
  if (input.sms) rows.push(smsRow(input.sms.consent, input.sms.optOut));
  rows.push(noticeRow(input.noticeAcks, input.currentNoticeVersion));
  if (input.waivers) for (const kind of MEAL_WAIVER_KINDS) rows.push(waiverRow(kind, input.waivers));
  return rows;
}
