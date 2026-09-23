"use client";

import { useActionState } from "react";
import Image from "next/image";
import { PhoneInput } from "@/lib/shared/phone-input";
import { type QrFormField, qrFormTheme } from "@/lib/marketing/qr";

export type CaptureResult = { ok: true } | { ok: false; error: string };

/** A bound server action: the token is already applied by the server page. */
export type CaptureAction = (
  prev: CaptureResult | null,
  formData: FormData,
) => Promise<CaptureResult>;

function CustomField({ field, focus }: { field: QrFormField; focus: string }) {
  const name = `custom_${field.key}`;
  const inputClass = `mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${focus}`;

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2">
        <input
          name={name}
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
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

/**
 * The public lead-capture card, shared by /q/<token> (managed codes) and
 * /lead/<token> (retail partner counter codes). The two routes differ only in
 * where the submission is written, which is what `action` carries.
 */
export function CaptureForm({
  eyebrow,
  title,
  intro,
  successMessage,
  collectPetName,
  collectZip,
  fields,
  theme,
  bannerUrl,
  action,
}: {
  eyebrow: string;
  title: string;
  intro: string | null;
  successMessage: string | null;
  collectPetName: boolean;
  collectZip: boolean;
  fields: QrFormField[];
  theme: string | null;
  bannerUrl: string | null;
  action: CaptureAction;
}) {
  const t = qrFormTheme(theme);
  const [result, formAction, pending] = useActionState<CaptureResult | null, FormData>(
    action,
    null,
  );
  const inputClass = `mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${t.focus}`;

  if (result?.ok) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Banner bannerUrl={bannerUrl} band={t.band} />
        <div className="p-8 text-center">
          <div
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl ${t.successIcon}`}
          >
            ✓
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">
            Thanks — you&apos;re all set!
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {successMessage ?? "The Green Dog Dental team will be in touch shortly."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <Banner bannerUrl={bannerUrl} band={t.band} />
      <div className="p-6 sm:p-8">
        <p className={`text-sm font-medium ${t.accentText}`}>{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
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
            <CustomField key={f.key} field={f} focus={t.focus} />
          ))}
        </div>

        {result?.ok === false && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${t.button}`}
        >
          {pending ? "Submitting…" : "Send my details"}
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">
          We only use your details to contact you about your pet&apos;s care.
        </p>
      </div>
    </form>
  );
}

function Banner({ bannerUrl, band }: { bannerUrl: string | null; band: string }) {
  if (bannerUrl) {
    return (
      <div className="relative h-32 w-full sm:h-40">
        <Image src={bannerUrl} alt="" fill sizes="28rem" className="object-cover" unoptimized />
      </div>
    );
  }
  return <div className={`h-2 w-full ${band}`} />;
}
