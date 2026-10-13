import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/sms/rules";
import { TIME_CLOCK_NOTICE_VERSION } from "@/lib/timeclock/notice";
import {
  buildAcknowledgements,
  type AcknowledgementRow,
  type NoticeAckRecord,
  type SmsConsentRecord,
  type SmsOptOutRecord,
} from "./acknowledgements";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Reads the employee's own acknowledgements for the Onboarding tab. Both
 * tables are service-role only, so the caller must already have gated the
 * viewer (HR profile, unrestricted view). `includeSms` follows canTextPerson
 * or the employee's own record.
 */
export async function loadPersonAcknowledgements(
  admin: Admin,
  person: { id: string; phone_mobile: string | null },
  opts: { includeSms: boolean },
): Promise<AcknowledgementRow[]> {
  const phone = opts.includeSms ? toE164(person.phone_mobile) : null;
  const [noticeRes, consentRes, optOutRes] = await Promise.all([
    admin
      .from("time_clock_notice_ack")
      .select("notice_version, acknowledged_at")
      .eq("person_id", person.id),
    opts.includeSms
      ? admin.from("sms_consent").select("source, consented_at").eq("person_id", person.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    phone
      ? admin.from("sms_opt_out").select("opted_out_at").eq("phone", phone).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const failed = noticeRes.error ?? consentRes.error ?? optOutRes.error;
  if (failed) throw new Error(`Could not load acknowledgements: ${failed.message}`);

  return buildAcknowledgements({
    noticeAcks: (noticeRes.data ?? []) as NoticeAckRecord[],
    currentNoticeVersion: TIME_CLOCK_NOTICE_VERSION,
    sms: opts.includeSms
      ? {
          consent: (consentRes.data as SmsConsentRecord | null) ?? null,
          optOut: (optOutRes.data as SmsOptOutRecord | null) ?? null,
        }
      : undefined,
  });
}
