"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function updateCandidate(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();

  const personPatch = {
    first_name: str(formData.get("first_name")),
    last_name: str(formData.get("last_name")),
    email: str(formData.get("email")),
    phone_mobile: str(formData.get("phone_mobile")),
    phone_home: str(formData.get("phone_home")),
    phone_other: str(formData.get("phone_other")),
    opportunity_type: str(formData.get("opportunity_type")),
  };
  const { error: pErr } = await supabase
    .from("person")
    .update(personPatch)
    .eq("id", personId);
  if (pErr) return { ok: false, error: pErr.message };

  const recPatch = {
    person_id: personId,
    pipeline: str(formData.get("pipeline")),
    stage: str(formData.get("stage")),
    target_title: str(formData.get("target_title")),
    source: str(formData.get("source")),
    interview_date: str(formData.get("interview_date")),
    score: num(formData.get("score")),
    resume_url: str(formData.get("resume_url")),
    keep_for_future: bool(formData.get("keep_for_future")),
    follow_up_date: str(formData.get("follow_up_date")),
    status_notes: str(formData.get("status_notes")),
    notes: str(formData.get("notes")),
  };
  const { error: rErr } = await supabase
    .from("person_recruiting")
    .upsert(recPatch, { onConflict: "person_id" });
  if (rErr) return { ok: false, error: rErr.message };

  revalidatePath(`/ats/${personId}`);
  revalidatePath("/ats");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Interview tracking
// ---------------------------------------------------------------------------

export async function saveInterview(
  personId: string,
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();
  const id = str(formData.get("interview_id"));

  // Collect structured question/answer pairs (question_<n> + answer_<n>).
  const responses: { index: number; question: string; answer: string | null }[] =
    [];
  for (const [key, value] of formData.entries()) {
    const m = /^question_(\d+)$/.exec(key);
    if (!m) continue;
    const idx = Number(m[1]);
    responses.push({
      index: idx,
      question: String(value),
      answer: str(formData.get(`answer_${m[1]}`)),
    });
  }
  responses.sort((a, b) => a.index - b.index);
  const cleanResponses = responses.map((r) => ({
    question: r.question,
    answer: r.answer,
  }));

  const patch = {
    person_id: personId,
    interview_date: str(formData.get("interview_date")),
    interview_type: str(formData.get("interview_type")),
    interviewer: str(formData.get("interviewer")),
    location: str(formData.get("location")),
    status: str(formData.get("status")) ?? "scheduled",
    overall_grade: str(formData.get("overall_grade")),
    recommendation: str(formData.get("recommendation")),
    summary: str(formData.get("summary")),
    responses: cleanResponses,
  };

  const { error } = id
    ? await supabase.from("person_interview").update(patch).eq("id", id)
    : await supabase.from("person_interview").insert(patch);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

export async function deleteInterview(
  personId: string,
  interviewId: string,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_interview")
    .delete()
    .eq("id", interviewId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}

// Convert a candidate into an employee: flip status + seed an employment row.
export async function hireCandidate(personId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("person")
    .update({ status: "employee", status_changed_at: new Date().toISOString() })
    .eq("id", personId);
  await supabase
    .from("person_employment")
    .upsert({ person_id: personId }, { onConflict: "person_id" });
  revalidatePath("/ats");
  revalidatePath("/hr");
  redirect(`/hr/${personId}`);
}

// Permanently delete a candidate record. Admin/owner only.
export async function deleteCandidate(personId: string): Promise<void> {
  const current = await getCurrentUser();
  if (!current || !isAdminRole(current.appUser.role)) {
    redirect("/ats");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("person").delete().eq("id", personId);
  if (error) {
    throw new Error(`Could not delete candidate: ${error.message}`);
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "delete",
    entity: "person",
    entityId: personId,
    summary: "Deleted recruiting candidate record",
  });

  revalidatePath("/ats");
  redirect("/ats");
}
