"use client";

import { useRef, useState, useTransition } from "react";
import { ACCEPTED_FILE_TYPES, type RecruitingFormField } from "@/lib/ats/forms";
import { FormQuestions, QuestionLabel, missingRequired, publicInput } from "@/lib/ats/form-renderer";
import { PhoneInput } from "@/lib/shared/phone-input";
import { PublicNotice } from "@/lib/ats/public-shell";
import { submitApplication } from "./actions";
import type { PublicJob } from "./load";

const OTHER = "__other__";

export function ApplicationForm({
  formId,
  fields,
  jobs,
  requireResume,
  successMessage,
  defaultJobId,
  source,
  preview = false,
}: {
  formId: string;
  fields: RecruitingFormField[];
  jobs: PublicJob[];
  requireResume: boolean;
  successMessage: string | null;
  defaultJobId?: string | null;
  source?: string | null;
  /** Builder preview: everything renders, nothing submits. */
  preview?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [job, setJob] = useState(defaultJobId ?? "");

  if (done) {
    return (
      <PublicNotice
        icon="✅"
        title="Application received"
        body={successMessage ?? "Thanks for applying! We'll be in touch."}
      />
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (preview) {
          setError("This is a preview — submissions are turned off.");
          return;
        }
        const form = e.currentTarget;
        const missing = missingRequired(fields, form);
        if (Object.keys(missing).length) {
          setErrors(missing);
          setError("Please answer the highlighted questions.");
          return;
        }
        setError(null);
        const fd = new FormData(form);
        startTransition(async () => {
          const res = await submitApplication(formId, fd);
          if (res.ok) {
            setDone(true);
            window.scrollTo({ top: 0 });
          } else {
            setError(res.error);
            setErrors(res.fieldErrors ?? {});
          }
        });
      }}
      className="space-y-5"
    >
      <input type="hidden" name="source" value={source ?? ""} />
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <QuestionLabel label="First name" required error={errors.first_name}>
          <input name="first_name" required autoComplete="given-name" className={publicInput} />
        </QuestionLabel>
        <QuestionLabel label="Last name" required error={errors.last_name}>
          <input name="last_name" required autoComplete="family-name" className={publicInput} />
        </QuestionLabel>
        <QuestionLabel label="Email" required error={errors.email}>
          <input name="email" type="email" required autoComplete="email" className={publicInput} />
        </QuestionLabel>
        <QuestionLabel label="Phone" required error={errors.phone}>
          <PhoneInput name="phone" required className={publicInput} />
        </QuestionLabel>
      </div>
      {/* Carrier (A2P 10DLC) opt-in: optional, never pre-checked, not a condition of applying. */}
      <label className="-mt-2 flex items-start gap-2 text-xs leading-relaxed text-slate-600">
        <input type="checkbox" name="sms_opt_in" value="yes" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-emerald-600" />
        <span>
          Text me about my application (optional). By checking this box, I agree to receive recruiting text messages from
          Green Dog at the number above, such as interview scheduling and reminders. Message frequency varies. Msg &amp;
          data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of applying. See our{" "}
          <a href="/privacy" target="_blank" className="text-emerald-700 underline">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/terms" target="_blank" className="text-emerald-700 underline">
            Terms
          </a>
          .
        </span>
      </label>

      <QuestionLabel label="Position applying for" required error={errors.job}>
        <select
          name="job"
          value={job === OTHER ? "" : job}
          onChange={(e) => setJob(e.target.value || "")}
          required={job !== OTHER}
          className={publicInput}
        >
          <option value="">Choose a position…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </QuestionLabel>
      <label className="-mt-3 flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={job === OTHER}
          onChange={(e) => setJob(e.target.checked ? OTHER : "")}
          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
        />
        My position isn&apos;t listed
      </label>
      {job === OTHER && (
        <QuestionLabel label="Which position?" required>
          <input name="job_other" required className={publicInput} />
        </QuestionLabel>
      )}

      <QuestionLabel label="Your city or ZIP code" required error={errors.location}>
        <input name="location" required autoComplete="postal-code" className={publicInput} />
      </QuestionLabel>

      <QuestionLabel label="Resume" required={requireResume} error={errors.resume} description="PDF, Word or a photo. Up to 15 MB.">
        <input
          name="resume"
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          required={requireResume}
          className={`${publicInput} file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-emerald-700`}
        />
      </QuestionLabel>

      <QuestionLabel label="Cover letter / notes" description="Optional — anything you'd like us to know.">
        <textarea name="cover_letter" rows={4} className={publicInput} />
      </QuestionLabel>

      {fields.length > 0 && (
        <div className="border-t border-slate-200 pt-5">
          <FormQuestions fields={fields} errors={errors} />
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
