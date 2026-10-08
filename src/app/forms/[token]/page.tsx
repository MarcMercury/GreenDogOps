import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFields } from "@/lib/ats/forms";
import { PublicNotice, PublicShell } from "@/lib/ats/public-shell";
import { QuestionnaireForm } from "./questionnaire-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Questionnaire — Green Dog", robots: { index: false } };

type FormJoin = { name: string; intro: string | null; success_message: string | null; fields: unknown };

export default async function QuestionnairePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("recruiting_form_request")
    .select("status, form:form_id (name, intro, success_message, fields), person:person_id (first_name)")
    .eq("token", token)
    .maybeSingle();
  const req = data as {
    status: string;
    form: FormJoin | FormJoin[] | null;
    person: { first_name: string | null } | { first_name: string | null }[] | null;
  } | null;
  const form = Array.isArray(req?.form) ? req?.form[0] : req?.form;
  const person = Array.isArray(req?.person) ? req?.person[0] : req?.person;

  if (!req || !form || req.status === "cancelled") {
    return (
      <PublicShell title="Questionnaire">
        <PublicNotice icon="🔗" title="This link is no longer active" body="Reply to the email you received and we'll send a new one." />
      </PublicShell>
    );
  }
  if (req.status === "completed") {
    return (
      <PublicShell title={form.name}>
        <PublicNotice icon="✅" title="Already submitted" body="Thanks — we have your answers." />
      </PublicShell>
    );
  }
  const greeting = person?.first_name ? `Hi ${person.first_name}! ` : "";
  return (
    <PublicShell
      title={form.name}
      intro={`${greeting}${form.intro ?? "Thanks for your interest in Green Dog. We'd like to learn a little more about you before scheduling your first interview."}`}
    >
      <QuestionnaireForm token={token} fields={parseFields(form.fields)} successMessage={form.success_message} />
    </PublicShell>
  );
}
