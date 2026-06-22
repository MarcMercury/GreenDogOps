"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, ensureCanEdit, recordAudit } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import {
  workbookToRows,
  rowsToCandidates,
  extractListCandidates,
  extractResumeCandidate,
} from "@/lib/ats/import";
import {
  candidateHasIdentity,
  type ParsedCandidate,
  type ParseListResult,
  type ParseResumeResult,
  type CreateCandidatesResult,
} from "@/lib/ats/import-types";

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
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
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
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
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
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
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
// The person status trigger cascades the rest (scheduling eligibility, a
// schedule settings row, and any linked login account).
export async function hireCandidate(personId: string): Promise<void> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) redirect(`/ats/${personId}`);
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
  revalidatePath("/schedule");
  revalidatePath("/schedule/setup");
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

// ---------------------------------------------------------------------------
// Candidate import — list (CSV/Excel/PDF) and single-resume (any format)
// ---------------------------------------------------------------------------

const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Parse an uploaded list of candidates (CSV / XLS / XLSX, or a PDF/image
 * roster) into structured rows for review. Nothing is written here — the
 * client reviews/edits the rows and then calls `createCandidates`.
 */
export async function parseCandidateList(formData: FormData): Promise<ParseListResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.size === 0) return { ok: false, error: "The uploaded file is empty." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "File too large (max 15 MB)." };
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const isSpreadsheet = /\.(csv|xls|xlsx)$/.test(name) || file.type.includes("spreadsheet");
  const isPdfOrImage =
    name.endsWith(".pdf") || file.type === "application/pdf" || file.type.startsWith("image/");

  if (isSpreadsheet) {
    try {
      const rows = workbookToRows(buffer);
      const { candidates, warnings } = rowsToCandidates(rows);
      if (!candidates.length) {
        return {
          ok: false,
          error: warnings[0] ?? "No candidates were found in the file.",
        };
      }
      return { ok: true, candidates, warnings };
    } catch {
      return { ok: false, error: "Could not read the spreadsheet. Check the file and try again." };
    }
  }

  if (isPdfOrImage) {
    const result = await extractListCandidates(file.name, file.type, buffer);
    if (!result.ok) return result;
    return { ok: true, candidates: result.candidates, warnings: [] };
  }

  return {
    ok: false,
    error: "Unsupported file type. Upload a CSV, Excel, PDF, or image file.",
  };
}

/**
 * Parse a single uploaded resume (PDF, Word, image, or text) into one
 * candidate using the configured LLM. Returns the extracted fields for review.
 */
export async function parseResumeFile(formData: FormData): Promise<ParseResumeResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.size === 0) return { ok: false, error: "The uploaded file is empty." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "File too large (max 15 MB)." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await extractResumeCandidate(file.name, file.type, buffer);
  if (!result.ok) return result;
  return { ok: true, candidate: result.candidate };
}

/**
 * Create recruiting candidates from reviewed rows. Each becomes a `person`
 * (status = applicant) plus a `person_recruiting` row. Blank fields are left
 * for manual entry. Partial success is reported per-row.
 */
export async function createCandidates(
  candidates: ParsedCandidate[],
): Promise<CreateCandidatesResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return { ok: false, error: gate.error };
  const supabase = await createClient();

  const valid = candidates.filter(candidateHasIdentity);
  if (!valid.length) {
    return { ok: false, error: "No candidates with a name or email to create." };
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const c of valid) {
    const label =
      c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "candidate";
    const fullName =
      c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || null;

    const { data: person, error: pErr } = await supabase
      .from("person")
      .insert({
        status: "applicant",
        first_name: c.first_name,
        last_name: c.last_name,
        full_name: fullName,
        email: c.email,
        phone_mobile: c.phone_mobile,
        opportunity_type: c.opportunity_type,
        notes: c.notes,
      })
      .select("id")
      .single();

    if (pErr || !person) {
      failed++;
      errors.push(`${label}: ${pErr?.message ?? "could not create person"}`);
      continue;
    }

    const hasRecruiting =
      c.target_title || c.pipeline || c.stage || c.source || c.score != null || c.status_notes;
    if (hasRecruiting) {
      const { error: rErr } = await supabase.from("person_recruiting").upsert(
        {
          person_id: person.id,
          target_title: c.target_title,
          pipeline: c.pipeline,
          stage: c.stage,
          source: c.source,
          score: c.score,
          status_notes: c.status_notes,
        },
        { onConflict: "person_id" },
      );
      if (rErr) errors.push(`${label}: saved, but recruiting details failed (${rErr.message}).`);
    }

    created++;
  }

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: "import",
    entity: "person",
    summary: `Imported ${created} recruiting candidate${created === 1 ? "" : "s"}`,
    metadata: { created, failed },
  });

  revalidatePath("/ats");
  return { ok: true, created, failed, errors };
}
