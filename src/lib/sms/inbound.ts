import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/ats/slack-notify";
import { isEmailConfigured, sendEmail } from "@/lib/shared/email";
import { isCandidateStatus } from "@/lib/auth/permissions";
import { classifyKeyword, e164ToHouseFormat, normalizeStatus, statusesReplaceableBy } from "./rules";

// ---------------------------------------------------------------------------
// Twilio webhooks (already signature-checked by the route): replies and STOP /
// START keywords, and delivery-status updates. Both are idempotent on the
// Message SID, because Twilio retries webhooks.
// ---------------------------------------------------------------------------

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Who sent this reply: the person we last texted at that number, else a unique phone match. */
async function matchPerson(admin: ReturnType<typeof createAdminClient>, phone: string): Promise<string | null> {
  const { data: last } = await admin
    .from("sms_message")
    .select("person_id")
    .eq("phone", phone)
    .eq("direction", "outbound")
    .not("person_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.person_id) return last.person_id as string;

  const house = e164ToHouseFormat(phone);
  if (!house) return null;
  const { data: people } = await admin.from("person").select("id").eq("phone_mobile", house).limit(2);
  return people?.length === 1 ? (people[0].id as string) : null;
}

/** Email the staff member who last texted this number that a reply came in. */
async function notifyReply(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  personId: string | null,
  body: string,
): Promise<void> {
  if (!isEmailConfigured()) return;
  const { data: last } = await admin
    .from("sms_message")
    .select("sent_by")
    .eq("phone", phone)
    .eq("direction", "outbound")
    .not("sent_by", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last?.sent_by) return;
  const { data: user } = await admin.from("app_user").select("email, is_active").eq("id", last.sent_by).maybeSingle();
  if (!user?.email || !user.is_active) return;

  let who = phone;
  let link: string | null = null;
  if (personId) {
    const { data: p } = await admin.from("person").select("full_name, first_name, last_name, status").eq("id", personId).maybeSingle();
    if (p) {
      who = (p.full_name as string | null)?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || phone;
      link = isCandidateStatus(p.status as string) ? `${appBaseUrl()}/ats/${personId}?tab=texts` : `${appBaseUrl()}/hr/${personId}`;
    }
  }
  const text = [`${who} replied to your text:`, body, link ? `Open in Ops: ${link}` : `From ${phone}`].join("\n\n");
  const res = await sendEmail({
    to: user.email as string,
    subject: `Text reply from ${who}`,
    text,
    tags: [{ name: "category", value: "sms_reply" }],
  });
  if (!res.ok) console.error("[sms] reply notification failed:", res.error);
}

export async function handleInboundSms(params: Record<string, string>): Promise<void> {
  const from = params.From?.trim();
  const sid = params.MessageSid?.trim();
  const body = params.Body ?? "";
  if (!from || !E164_RE.test(from) || !sid) {
    console.error("[sms] inbound webhook missing From/MessageSid");
    return;
  }
  const admin = createAdminClient();

  const keyword = classifyKeyword(body);
  if (keyword === "stop") {
    await admin.from("sms_opt_out").upsert({ phone: from, keyword: body.trim().toUpperCase().slice(0, 20) }, { onConflict: "phone" });
  } else if (keyword === "start") {
    await admin.from("sms_opt_out").delete().eq("phone", from);
  }

  const personId = await matchPerson(admin, from);
  const { data: inserted, error } = await admin
    .from("sms_message")
    .upsert(
      { person_id: personId, direction: "inbound", phone: from, body, status: "received", twilio_sid: sid },
      { onConflict: "twilio_sid", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("[sms] inbound log failed:", error.message);
    return;
  }
  // A retried webhook inserts nothing, so the reply is only announced once.
  // "Yes"/"Help" are usually real answers, so only STOP goes unannounced.
  if (inserted?.length && keyword !== "stop") await notifyReply(admin, from, personId, body);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `messageId` is the ?m= on the callback URL (signed by Twilio with the rest
 * of the URL); it finds the row even before the send saved the SID.
 */
export async function handleStatusCallback(params: Record<string, string>, messageId: string | null): Promise<void> {
  const sid = params.MessageSid?.trim();
  const next = normalizeStatus(params.MessageStatus);
  if (!sid) return;
  const admin = createAdminClient();
  let { data: row } = await admin.from("sms_message").select("id, twilio_sid").eq("twilio_sid", sid).maybeSingle();
  if (!row && messageId && UUID_RE.test(messageId)) {
    ({ data: row } = await admin
      .from("sms_message")
      .select("id, twilio_sid")
      .eq("id", messageId)
      .eq("direction", "outbound")
      .maybeSingle());
    if (row && row.twilio_sid && row.twilio_sid !== sid) return;
  }
  if (!row) return;
  // Conditional on the stored status, so a late or concurrent callback can't move it backwards.
  await admin
    .from("sms_message")
    .update({
      status: next,
      ...(row.twilio_sid ? {} : { twilio_sid: sid }),
      ...(params.ErrorCode ? { error_code: params.ErrorCode, error_message: params.ErrorMessage || `Twilio error ${params.ErrorCode}` } : {}),
    })
    .eq("id", row.id)
    .in("status", statusesReplaceableBy(next));
}
