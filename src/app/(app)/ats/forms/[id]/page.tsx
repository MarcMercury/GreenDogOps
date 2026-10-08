import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { parseFields, type FormKind, type RecruitingForm } from "@/lib/ats/forms";
import { RECRUITING_POSITION_OPTIONS } from "@/lib/ats/types";
import { FormBuilder, type BuilderForm } from "./form-builder";

export const dynamic = "force-dynamic";

function blankForm(kind: FormKind): BuilderForm {
  return {
    id: null,
    kind,
    name: "",
    description: null,
    intro: null,
    success_message: null,
    fields: [],
    job_titles: [],
    slug: null,
    is_default: false,
    require_resume: kind === "application",
    active: true,
  };
}

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { id } = await params;
  const { kind } = await searchParams;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "ats") : false;

  let form: BuilderForm;
  if (id === "new") {
    form = blankForm(kind === "application" ? "application" : "screening");
  } else {
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
    const row = data as RecruitingForm;
    form = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      intro: row.intro,
      success_message: row.success_message,
      fields: parseFields(row.fields),
      job_titles: Array.isArray(row.job_titles) ? row.job_titles : [],
      slug: row.slug,
      is_default: row.is_default,
      require_resume: row.require_resume,
      active: row.active,
    };
  }

  let titleSuggestions: string[] = [];
  if (canEdit) {
    const { data: positionData } = await supabase.from("position").select("title");
    titleSuggestions = [
      ...new Set(
        [
          ...RECRUITING_POSITION_OPTIONS,
          ...((positionData ?? []) as { title: string | null }[]).map((p) => p.title),
        ]
          .map((t) => t?.trim())
          .filter((t): t is string => !!t),
      ),
    ].sort((a, b) => a.localeCompare(b));
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/ats?tab=forms" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to Forms
      </Link>
      {canEdit ? (
        <FormBuilder initial={form} titleSuggestions={titleSuggestions} />
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {form.name || "Recruiting form"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            You have view-only access to Recruiting, so you can&apos;t edit forms. Ask an admin
            for edit access if you need to change this form.
          </p>
        </div>
      )}
    </div>
  );
}
