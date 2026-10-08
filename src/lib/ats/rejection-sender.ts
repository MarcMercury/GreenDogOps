import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTemplate, type Rejection } from "./rejections";
import { sendRejectionEmail } from "./candidate-emails";

export interface RejectionRunResult {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Send every rejection email whose 48-hour window has passed. Each row is
 * claimed (scheduled → sending) before sending so overlapping cron runs can't
 * double-send. A candidate whose stage changed since the rejection (someone
 * moved them back without using Undo) is skipped, not emailed.
 */
export async function sendDueRejectionEmails(now = new Date()): Promise<RejectionRunResult> {
  const admin = createAdminClient();
  const out: RejectionRunResult = { due: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  const { data, error } = await admin
    .from("recruiting_rejection")
    .select("*")
    .eq("email_status", "scheduled")
    .is("undone_at", null)
    .lte("email_scheduled_for", now.toISOString())
    .order("email_scheduled_for")
    .limit(50);
  if (error) {
    out.errors.push(error.message);
    return out;
  }
  const due = (data ?? []) as Rejection[];
  out.due = due.length;

  for (const r of due) {
    const { data: claimed } = await admin
      .from("recruiting_rejection")
      .update({ email_status: "sending" })
      .eq("id", r.id)
      .eq("email_status", "scheduled")
      .select("id");
    if (!claimed?.length) continue;

    const finish = async (patch: Record<string, unknown>) => {
      await admin.from("recruiting_rejection").update(patch).eq("id", r.id);
    };

    const [{ data: person }, { data: template }] = await Promise.all([
      admin
        .from("person")
        .select("first_name, full_name, last_name, person_recruiting(stage, target_title, review_status)")
        .eq("id", r.person_id)
        .maybeSingle(),
      r.template_id
        ? admin.from("recruiting_email_template").select("subject, body").eq("id", r.template_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const p = person as {
      first_name: string | null;
      full_name: string | null;
      last_name: string | null;
      person_recruiting:
        | { stage: string | null; target_title: string | null; review_status: string | null }
        | { stage: string | null; target_title: string | null; review_status: string | null }[]
        | null;
    } | null;
    const rec = Array.isArray(p?.person_recruiting) ? p?.person_recruiting[0] : p?.person_recruiting;
    const tpl = template as { subject: string; body: string } | null;

    if (!p || !r.email_to) {
      await finish({ email_status: "not_sending", email_error: "No candidate or email address." });
      out.skipped++;
      continue;
    }
    if ((rec?.stage ?? null) !== r.rejected_stage) {
      await finish({ email_status: "cancelled", email_error: `Not sent: stage changed to ${rec?.stage ?? "none"} after the rejection.` });
      out.skipped++;
      continue;
    }
    if (rec?.review_status === "pending") {
      await finish({ email_status: "cancelled", email_error: "Not sent: they re-applied and are back in the Review Queue." });
      out.skipped++;
      continue;
    }
    if (!tpl) {
      await finish({ email_status: "failed", email_error: "The email template no longer exists." });
      out.failed++;
      continue;
    }

    const vars = {
      first_name: p.first_name,
      full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
      role: rec?.target_title ?? null,
    };
    const sent = await sendRejectionEmail({
      to: r.email_to,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
    });
    if (sent.ok) {
      await finish({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null });
      out.sent++;
    } else {
      await finish({ email_status: "failed", email_error: sent.error ?? "Send failed." });
      out.failed++;
      out.errors.push(`${r.id}: ${sent.error}`);
    }
  }
  return out;
}
