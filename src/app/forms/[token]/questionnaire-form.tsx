"use client";

import { useState, useTransition } from "react";
import type { RecruitingFormField } from "@/lib/ats/forms";
import { FormQuestions, missingRequired } from "@/lib/ats/form-renderer";
import { PublicNotice } from "@/lib/ats/public-shell";
import { submitQuestionnaire } from "./actions";

export function QuestionnaireForm({
  token,
  fields,
  successMessage,
  preview = false,
}: {
  token: string;
  fields: RecruitingFormField[];
  successMessage: string | null;
  preview?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (done) {
    return (
      <PublicNotice
        icon="✅"
        title="Thank you!"
        body={successMessage ?? "Your answers are in. We'll be in touch about next steps."}
      />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (preview) {
          setError("This is a preview — submissions are turned off.");
          return;
        }
        const missing = missingRequired(fields, e.currentTarget);
        if (Object.keys(missing).length) {
          setErrors(missing);
          setError("Please answer the highlighted questions.");
          return;
        }
        setError(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await submitQuestionnaire(token, fd);
          if (res.ok) {
            setDone(true);
            window.scrollTo({ top: 0 });
          } else {
            setError(res.error);
            setErrors(res.fieldErrors ?? {});
          }
        });
      }}
      className="space-y-6"
    >
      <FormQuestions fields={fields} errors={errors} />
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
