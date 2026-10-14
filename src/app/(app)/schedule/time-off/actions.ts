"use server";

import { revalidatePath } from "next/cache";
import { ensureCanEdit, recordAudit } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { runInBackground } from "@/lib/notify/emit";
import { notifyTimeOffDecided } from "@/lib/notify/events/schedule";
import { parseReview } from "@/lib/pto/balance";

export type ReviewResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Decide one pending time-off request from the triage queue: paid PTO or
 * unpaid, how many PTO days (0 = approve without deducting, e.g. already
 * counted elsewhere), and an optional note. The balance moves in the database
 * (0246 trigger), the same as approving from the grid, HR profile or Slack.
 */
export async function reviewPtoRequest(id: string, formData: FormData): Promise<ReviewResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown request." };
  const supabase = await createClient();
  const { data: row, error: loadErr } = await supabase
    .from("person_time_off")
    .select("id, person_id, status, start_date, end_date")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row) return { ok: false, error: "That request no longer exists." };
  if (row.status !== "requested") return { ok: false, error: "That request was already decided. Refresh the page." };
  if (gate.current.appUser.person_id && row.person_id === gate.current.appUser.person_id) {
    return { ok: false, error: "You can't decide your own request." };
  }

  const parsed = parseReview(
    {
      decision: String(formData.get("decision") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      days: String(formData.get("days") ?? ""),
      note: String(formData.get("note") ?? ""),
    },
    row as { start_date: string; end_date: string },
  );
  if (!parsed.ok) return parsed;
  const { status, kind, ptoDays, note } = parsed.value;

  const { data: updated, error } = await supabase
    .from("person_time_off")
    .update({
      status,
      kind,
      ...(status === "approved" ? { pto_days: ptoDays } : {}),
      review_note: note,
      reviewed_by: gate.current.authId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "requested")
    .select("id, pto_days_deducted");
  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: "That request was already decided. Refresh the page." };
  const deducted = Number(updated[0].pto_days_deducted ?? 0);

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: `time_off.${status === "approved" ? "approve" : "deny"}`,
    entity: "person_time_off",
    entityId: id,
    summary: `${status === "approved" ? "Approved" : "Denied"} ${row.start_date} – ${row.end_date} as ${kind}${status === "approved" ? ` (${deducted} PTO day(s) deducted)` : ""}`,
    metadata: { kind, pto_days: ptoDays, deducted, note },
  });
  const reviewerName = gate.current.appUser.full_name?.trim() || gate.current.email;
  runInBackground(() => notifyTimeOffDecided({ timeOffId: id, status, reviewerName, actorUserId: gate.current.appUser.id }));
  revalidatePath("/schedule/time-off");
  revalidatePath("/schedule");
  revalidatePath(`/hr/${row.person_id}`);
  return {
    ok: true,
    message: status === "approved" ? (deducted ? `Approved — ${deducted} PTO day(s) deducted.` : "Approved (no PTO deducted).") : "Denied.",
  };
}
