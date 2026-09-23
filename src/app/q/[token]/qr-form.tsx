"use client";

import { useActionState } from "react";
import { PhoneInput } from "@/lib/shared/phone-input";
import type { QrFormField } from "@/lib/marketing/qr";
import { submitQrLead, type QrLeadResult } from "./actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

function CustomField({ field }: { field: QrFormField }) {
  const name = `custom_${field.key}`;
  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2">
        <input
          name={name}
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        <span className="text-sm text-slate-700">{field.label}</span>
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>
      {field.type === "select" ? (
        <select name={name} required={field.required} defaultValue="" className={inputClass}>
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          name={name}
          rows={3}
          required={field.required}
          placeholder={field.placeholder ?? undefined}
          className={inputClass}
        />
      ) : field.type === "phone" ? (
        <PhoneInput name={name} className={inputClass} />
      ) : (
        <input
          name={name}
          type={field.type === "email" ? "email" : "text"}
          required={field.required}
          placeholder={field.placeholder ?? undefined}
          className={inputClass}
        />
      )}
    </label>
  );
}

export function QrCaptureForm({
  token,
  label,
  headline,
  intro,
  successMessage,
  collectPetName,
  collectZip,
  fields,
}: {
  token: string;
  label: string;
  headline: string | null;
  intro: string | null;
  successMessage: string | null;
  collectPetName: boolean;
  collectZip: boolean;
  fields: QrFormField[];
}) {
  const [result, formAction, pending] = useActionState<QrLeadResult | null, FormData>(
    (prev, fd) => submitQrLead(token, prev, fd),
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
          {successMessage ?? "The Green Dog Dental team will be in touch shortly."}
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-sm text-slate-500">You scanned</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{headline ?? label}</h1>
      {intro && <p className="mt-2 text-sm text-slate-600">{intro}</p>}

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
        {collectPetName && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Pet&apos;s name</span>
            <input name="pet_name" type="text" className={inputClass} />
          </label>
        )}
        {collectZip && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">ZIP code</span>
            <input name="zip" type="text" inputMode="numeric" className={inputClass} />
          </label>
        )}
        {fields.map((f) => (
          <CustomField key={f.key} field={f} />
        ))}
      </div>

      {result?.ok === false && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
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
