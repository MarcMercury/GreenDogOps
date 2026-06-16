"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
