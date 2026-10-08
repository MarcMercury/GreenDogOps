"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit, recordAudit, type CurrentUser } from "@/lib/auth/session";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { isSlackConfigured } from "@/lib/slack/client";
import { isEmailConfigured } from "@/lib/shared/email";
import {
  formFieldProblems,
  parseFields,
  slugify,
  type FormKind,
  type RecruitingFormField,
} from "@/lib/ats/forms";
import { linkToken } from "@/lib/ats/scheduling";
import { appBaseUrl, candidateName, notifyCandidateThread } from "@/lib/ats/slack-notify";
import { buildFormSentMessage } from "@/lib/ats/slack-messages";
import { sendQuestionnaireEmail } from "@/lib/ats/candidate-emails";

export type FormSaveResult = { ok: true; id: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

function actorName(current: CurrentUser): string {
  return current.appUser.full_name ?? current.email.split("@")[0];
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s === "" ? null : s;
}

export interface FormInput {
  id?: string | null;
  kind: FormKind;
  name: string;
  description?: string | null;
  intro?: string | null;
  success_message?: string | null;
  fields: RecruitingFormField[];
  job_titles: string[];
  slug?: string | null;
  require_resume?: boolean;
  active: boolean;
}

/** Create or update a form from the builder. The kind is fixed once created. */
export async function saveForm(input: FormInput): Promise<FormSaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const name = clean(input.name, 120);
  if (!name) return { ok: false, error: "Give the form a name." };
  if (input.kind !== "application" && input.kind !== "screening") {
    return { ok: false, error: "Unknown form type." };
  }
  const fields = parseFields(input.fields);
  if (fields.length !== (Array.isArray(input.fields) ? input.fields.length : 0)) {
    return { ok: false, error: "Some questions couldn't be read. Reload the builder and try again." };
  }
  const problems = formFieldProblems(fields);
  if (problems.length) return { ok: false, error: problems[0] };

  const jobTitles = [
    ...new Set((input.job_titles ?? []).map((t) => clean(t, 80)).filter((t): t is string => !!t)),
  ];
  const slug = input.kind === "application" ? slugify(input.slug || name) || null : null;
  if (input.kind === "application" && !slug) return { ok: false, error: "Give the application a link name." };

  if (input.id) {
    const { data } = await supabase
      .from("recruiting_form")
      .select("kind, is_default")
      .eq("id", input.id)
      .maybeSingle();
    const existing = data as { kind: FormKind; is_default: boolean } | null;
    if (!existing) return { ok: false, error: "That form no longer exists." };
    if (existing.kind !== input.kind) return { ok: false, error: "A form's type can't be changed." };
    if (existing.is_default && !input.active) {
      return { ok: false, error: "This is the application at /apply. Make another application the default before deactivating it." };
    }
  }

  const row = {
    kind: input.kind,
    name,
    description: clean(input.description, 1000),
    intro: clean(input.intro, 4000),
    success_message: clean(input.success_message, 2000),
    fields,
    job_titles: jobTitles,
    slug,
    require_resume: input.kind === "application" ? input.require_resume !== false : false,
    active: input.active,
  };

  const res = input.id
    ? await supabase.from("recruiting_form").update(row).eq("id", input.id).select("id").single()
    : await supabase
        .from("recruiting_form")
        .insert({ ...row, created_by: gate.current.authId })
        .select("id")
        .single();
  if (res.error || !res.data) {
    if (res.error?.code === "23505") return { ok: false, error: `The link /apply/${slug} is already used by another form.` };
    return { ok: false, error: res.error?.message ?? "Could not save the form." };
  }
  const id = (res.data as { id: string }).id;

  await recordAudit({
    actorId: gate.current.authId,
    actorEmail: gate.current.email,
    action: input.id ? "update" : "create",
    entity: "recruiting_form",
    entityId: id,
    summary: `${input.id ? "Updated" : "Created"} recruiting form ${name}`,
  });
  revalidatePath("/ats");
  revalidatePath(`/ats/forms/${id}`);
  return { ok: true, id };
}

export async function duplicateForm(id: string): Promise<FormSaveResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data } = await supabase.from("recruiting_form").select("*").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "That form no longer exists." };
  const src = data as Record<string, unknown> & { name: string; kind: FormKind; slug: string | null };

  let slug: string | null = null;
  if (src.kind === "application") {
    const base = `${src.slug ?? slugify(src.name)}-copy`;
    const { data: taken } = await supabase.from("recruiting_form").select("slug").like("slug", `${base}%`);
    const used = new Set(((taken ?? []) as { slug: string }[]).map((t) => t.slug));
    slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  }
  const { data: created, error } = await supabase
    .from("recruiting_form")
    .insert({
      kind: src.kind,
      name: `Copy of ${src.name}`.slice(0, 120),
      description: src.description,
      intro: src.intro,
      success_message: src.success_message,
      fields: src.fields,
      job_titles: src.job_titles,
      slug,
      require_resume: src.require_resume,
      is_default: false,
      active: false,
      created_by: gate.current.authId,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not duplicate the form." };
  revalidatePath("/ats");
  return { ok: true, id: (created as { id: string }).id };
}

export async function setFormActive(id: string, active: boolean): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  if (!active) {
    const { data } = await supabase.from("recruiting_form").select("is_default").eq("id", id).maybeSingle();
    if ((data as { is_default?: boolean } | null)?.is_default) {
      return { ok: false, error: "This is the application at /apply. Make another application the default first." };
    }
  }
  const { error } = await supabase.from("recruiting_form").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ats");
  return { ok: true };
}

/** Serve this application at /apply. */
export async function setDefaultApplication(id: string): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data } = await supabase.from("recruiting_form").select("kind").eq("id", id).maybeSingle();
  if ((data as { kind?: string } | null)?.kind !== "application") {
    return { ok: false, error: "Only an application form can be the default." };
  }
  const { error: clearErr } = await supabase
    .from("recruiting_form")
    .update({ is_default: false })
    .eq("is_default", true)
    .neq("id", id);
  if (clearErr) return { ok: false, error: clearErr.message };
  const { error } = await supabase.from("recruiting_form").update({ is_default: true, active: true }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ats");
  return { ok: true };
}

export type SendFormResult =
  | { ok: true; url: string; emailed: boolean; warning?: string }
  | { ok: false; error: string };

function questionnaireUrl(token: string): string {
  return `${appBaseUrl()}/forms/${token}`;
}

/**
 * Send a role-specific form to a candidate: a unique link, emailed to them,
 * posted in their Slack thread. Re-sending the same form cancels the older
 * unanswered link so only one is live.
 */
export async function sendFormToCandidate(personId: string, formId: string): Promise<SendFormResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const [{ data: formData }, { data: personData }] = await Promise.all([
    supabase.from("recruiting_form").select("id, name, kind, active").eq("id", formId).maybeSingle(),
    supabase.from("person").select("id, full_name, first_name, last_name, email").eq("id", personId).maybeSingle(),
  ]);
  const form = formData as { id: string; name: string; kind: string; active: boolean } | null;
  const person = personData as {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  if (!form || form.kind !== "screening") return { ok: false, error: "Pick a role-specific form." };
  if (!form.active) return { ok: false, error: `${form.name} is inactive. Activate it on the Forms tab first.` };
  if (!person) return { ok: false, error: "That candidate no longer exists." };

  await supabase
    .from("recruiting_form_request")
    .update({ status: "cancelled" })
    .eq("person_id", personId)
    .eq("form_id", formId)
    .eq("status", "sent");

  const token = linkToken();
  const { error } = await supabase.from("recruiting_form_request").insert({
    token,
    form_id: formId,
    person_id: personId,
    sent_to: person.email,
    sent_by: gate.current.authId,
    sent_by_name: actorName(gate.current),
  });
  if (error) return { ok: false, error: error.message };
  const url = questionnaireUrl(token);

  let emailed = false;
  let warning: string | undefined;
  if (!person.email) {
    warning = "No email on file — copy the link and send it yourself.";
  } else if (!isEmailConfigured()) {
    warning = "Email isn't set up — copy the link and send it yourself.";
  } else {
    const sent = await sendQuestionnaireEmail({
      to: person.email,
      firstName: person.first_name,
      formName: form.name,
      url,
    });
    emailed = sent.ok;
    if (!sent.ok) warning = `The email didn't send (${sent.error}). Copy the link and send it yourself.`;
  }

  const name = candidateName(person);
  await logProfileTransition({
    personId,
    eventType: "form_sent",
    detail: `${form.name} sent${emailed ? ` to ${person.email}` : ""}`,
    actorId: gate.current.authId,
    actorName: actorName(gate.current),
  });
  if (isSlackConfigured()) {
    await notifyCandidateThread({
      personId,
      text: buildFormSentMessage(name, form.name, actorName(gate.current)),
      username: actorName(gate.current),
      actorId: gate.current.authId,
      actorEmail: gate.current.email,
    });
  }
  revalidatePath(`/ats/${personId}`);
  return { ok: true, url, emailed, ...(warning ? { warning } : {}) };
}

export async function cancelFormRequest(personId: string, requestId: string): Promise<SimpleResult> {
  const gate = await ensureCanEdit("ats");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase
    .from("recruiting_form_request")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("person_id", personId)
    .eq("status", "sent");
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/ats/${personId}`);
  return { ok: true };
}
