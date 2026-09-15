"use client";

import { useActionState } from "react";
import { PhoneInput } from "@/lib/shared/phone-input";
import { submitRetailLead, type LeadResult } from "./actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export function RetailLeadForm({
  token,
  partnerName,
}: {
  token: string;
  partnerName: string;
}) {
  const [result, formAction, pending] = useActionState<LeadResult | null, FormData>(
    (prev, fd) => submitRetailLead(token, prev, fd),
    null,
  );

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Thanks — you&apos;re all set!</h2>
        <p className="mt-2 text-sm text-slate-600">
          Green Dog Dental will be in touch shortly. Thanks for visiting{" "}
          <span className="font-semibold text-slate-800">{partnerName}</span>.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-sm text-slate-500">You scanned the code at</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{partnerName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Leave your details and the Green Dog Dental team will reach out about
        caring for your pet.
      </p>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Your name</span>
          <input name="full_name" type="text" required autoComplete="name" className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input name="email" type="email" autoComplete="email" className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Phone number</span>
          <PhoneInput name="phone" className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Pet&apos;s name</span>
          <input name="pet_name" type="text" className={inputClass} />
        </label>
      </div>

      {result?.ok === false && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Send my details"}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        We only use your details to contact you about your pet&apos;s care.
      </p>
    </form>
  );
}
