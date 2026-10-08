import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { parseFields, type RecruitingForm } from "@/lib/ats/forms";
import { PublicShell } from "@/lib/ats/public-shell";
import { ApplicationForm } from "@/app/apply/application-form";
import { loadOpenJobs } from "@/app/apply/load";
import { QuestionnaireForm } from "@/app/forms/[token]/questionnaire-form";

export const dynamic = "force-dynamic";

export default async function FormPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "new") notFound();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "ats") : false;

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-4xl">
        <Link href="/ats?tab=forms" className="text-sm text-emerald-700 hover:text-emerald-900">
          ← Back to Forms
        </Link>
        <p className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          You have view-only access to Recruiting, so you can&apos;t preview forms. Ask an admin
          for edit access if you need to.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruiting_form")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load form: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();
  const form = data as RecruitingForm;
  const fields = parseFields(form.fields);

  return (
    <div>
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        👀 Preview — submissions are turned off
        {!form.active && (
          <span className="font-normal text-amber-800"> · This form is inactive.</span>
        )}
      </div>
      <PublicShell title={form.name} intro={form.intro}>
        {form.kind === "application" ? (
          <ApplicationForm
            formId={form.id}
            fields={fields}
            jobs={await loadOpenJobs()}
            requireResume={form.require_resume}
            successMessage={form.success_message}
            preview
          />
        ) : (
          <QuestionnaireForm
            token="preview"
            fields={fields}
            successMessage={form.success_message}
            preview
          />
        )}
      </PublicShell>
    </div>
  );
}
