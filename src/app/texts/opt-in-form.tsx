"use client";

import { useState, useTransition } from "react";
import { QuestionLabel, publicInput } from "@/lib/ats/form-renderer";
import { PhoneInput } from "@/lib/shared/phone-input";
import { PublicNotice } from "@/lib/ats/public-shell";
import { optInToTexts } from "./actions";

export function OptInForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (done) {
    return (
      <PublicNotice
        icon="✅"
        title="Thanks!"
        body={
          "If this number matches our records, you're signed up for Green Dog Dental Recruiting & HR texts.\n\n" +
          "Reply STOP to any message to opt out, or HELP for help. If you replied STOP before, text START to our number to turn texts back on."
        }
      />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await optInToTexts(fd);
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
      </div>
      <QuestionLabel label="Mobile number" required error={errors.phone} description="The number on file with Green Dog.">
        <PhoneInput name="phone" required autoComplete="tel" className={publicInput} />
      </QuestionLabel>

      {/* Wording matches the registered A2P campaign's message flow; change both together. */}
      <label className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
        <input type="checkbox" name="agree" value="yes" className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600" />
        <span>
          I agree to receive recruiting and work text messages from Green Dog Dental (Mobile Vet Services, LLC) at the
          number above, such as interview and schedule updates and HR notices. Message frequency varies. Msg &amp; data
          rates may apply. Reply STOP to opt out, HELP for help. Signing up is voluntary and is not a condition of
          applying or of employment. Terms:{" "}
          <a href="/terms" target="_blank" className="text-emerald-700 underline">
            greendogops.com/terms
          </a>{" "}
          Privacy:{" "}
          <a href="/privacy" target="_blank" className="text-emerald-700 underline">
            greendogops.com/privacy
          </a>
        </span>
      </label>
      {errors.agree && <p className="-mt-3 text-xs text-rose-700">{errors.agree}</p>}

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Signing up…" : "Sign up for texts"}
      </button>
    </form>
  );
}
