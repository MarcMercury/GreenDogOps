"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeResume } from "@/lib/ats/applicant-intake";
import { guessDocumentCategory } from "@/lib/ats/document-category";
import {
  fileProblem,
  parseFields,
  readSubmission,
  validateAnswers,
  type AnswerValue,
} from "@/lib/ats/forms";
import { buildFormCompletedMessage } from "@/lib/ats/slack-messages";
import { candidateName, candidateProfileUrl, notifyCandidateThread } from "@/lib/ats/slack-notify";
import { isSlackConfigured } from "@/lib/slack/client";
import { logProfileTransition } from "@/lib/shared/transition-log";

export type QuestionnaireResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * A candidate submits the questionnaire sent to them. The token in the link is
 * the only credential; each link takes one submission.
 */
export async function submitQuestionnaire(token: string, fd: FormData): Promise<QuestionnaireResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("recruiting_form_request")
    .select("id, person_id, status, form:form_id (id, name, kind, fields)")
    .eq("token", token)
    .maybeSingle();
  const req = data as {
    id: string;
    person_id: string;
    status: string;
    form: { id: string; name: string; kind: string; fields: unknown } | { id: string; name: string; kind: string; fields: unknown }[] | null;
  } | null;
  const form = Array.isArray(req?.form) ? req?.form[0] : req?.form;
  if (!req || !form || req.status === "cancelled") {
    return { ok: false, error: "This questionnaire link is no longer active." };
  }
  if (req.status === "completed") return { ok: false, error: "You've already submitted this questionnaire. Thank you!" };

  const fields = parseFields(form.fields);
  const { raw, files } = readSubmission(fields, fd);
  const checked = validateAnswers(fields, raw, new Set(files.keys()));
  const fieldErrors = { ...checked.errors };
  for (const [id, file] of files) {
    const p = fileProblem(file);
    if (p) fieldErrors[id] = p;
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: "Please fix the highlighted answers.", fieldErrors };
  }

  // Claim the link first so a double submit can't record twice.
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("recruiting_form_request")
    .update({ status: "completed", completed_at: now })
    .eq("id", req.id)
    .eq("status", "sent")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "You've already submitted this questionnaire. Thank you!" };

  const answers: Record<string, AnswerValue> = { ...checked.answers };
  for (const [id, file] of files) {
    const docId = await storeResume(
      admin,
      req.person_id,
      {
        fileName: file.name || "upload",
        contentType: file.type || "application/octet-stream",
        buffer: Buffer.from(await file.arrayBuffer()),
        category: guessDocumentCategory(file.name, "other"),
      },
      `Form: ${form.name}`,
    );
    if (docId) answers[id] = { document_id: docId, file_name: file.name };
  }

  const { error } = await admin.from("recruiting_form_response").insert({
    form_id: form.id,
    request_id: req.id,
    person_id: req.person_id,
    form_name: form.name,
    form_kind: form.kind,
    fields,
    answers,
  });
  if (error) {
    await admin
      .from("recruiting_form_request")
      .update({ status: "sent", completed_at: null })
      .eq("id", req.id);
    console.error("[forms] response save failed:", error.message);
    return { ok: false, error: "We couldn't save your answers. Please try again." };
  }

  await logProfileTransition({
    personId: req.person_id,
    eventType: "form_completed",
    detail: `${form.name} completed`,
  });
  if (isSlackConfigured()) {
    const { data: person } = await admin
      .from("person")
      .select("full_name, first_name, last_name")
      .eq("id", req.person_id)
      .maybeSingle();
    if (person) {
      await notifyCandidateThread({
        personId: req.person_id,
        text: buildFormCompletedMessage(
          candidateName(person),
          form.name,
          `${candidateProfileUrl(req.person_id)}?tab=forms`,
        ),
      });
    }
  }
  revalidatePath(`/ats/${req.person_id}`);
  return { ok: true };
}
