"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import { PhoneInput } from "@/lib/shared/phone-input";
import {
  type CaptureReceipt,
  type QrFormField,
  type QrFormTheme,
  OTHER_VALUE,
  otherFieldName,
  qrFormTheme,
  scaleRange,
} from "@/lib/marketing/qr";

export type CaptureResult =
  | { ok: true; receipt?: CaptureReceipt }
  | { ok: false; error: string };


/** A bound server action: the token is already applied by the server page. */
export type CaptureAction = (
  prev: CaptureResult | null,
  formData: FormData,
) => Promise<CaptureResult>;

function Prompt({ field }: { field: QrFormField }) {
  return (
    <>
      <span className="text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>
      {field.description && (
        <span className="mt-0.5 block text-xs text-slate-500">{field.description}</span>
      )}
    </>
  );
}

/** Free-text box revealed by the "Other…" choice. */
function OtherInput({
  field,
  focus,
  show,
}: {
  field: QrFormField;
  focus: string;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <input
      name={otherFieldName(field.key)}
      type="text"
      placeholder="Your answer"
      className={`mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${focus}`}
    />
  );
}

function CustomField({ field, focus }: { field: QrFormField; focus: string }) {
  const name = `custom_${field.key}`;
  const inputClass = `mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${focus}`;
  const [choice, setChoice] = useState("");
  const [others, setOthers] = useState(false);

  if (field.type === "heading") {
    return (
      <div className="border-t border-slate-200 pt-4">
        <h2 className="text-base font-semibold text-slate-900">{field.label}</h2>
        {field.description && (
          <p className="mt-1 text-sm text-slate-600">{field.description}</p>
        )}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2">
        <input
          name={name}
          type="checkbox"
          required={field.required}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">
          {field.label}
          {field.description && (
            <span className="mt-0.5 block text-xs text-slate-500">{field.description}</span>
          )}
        </span>
      </label>
    );
  }

  if (field.type === "radio" || field.type === "multiselect") {
    const many = field.type === "multiselect";
    return (
      <fieldset>
        <legend className="block">
          <Prompt field={field} />
        </legend>
        <div className="mt-2 space-y-1.5">
          {field.options.map((o) => (
            <label key={o} className="flex items-start gap-2">
              <input
                name={name}
                type={many ? "checkbox" : "radio"}
                value={o}
                // A required radio group needs the attribute on every member.
                required={field.required && !many && !field.allowOther}
                onChange={() => !many && setChoice(o)}
                className={`mt-0.5 h-4 w-4 border-slate-300 ${many ? "rounded" : ""}`}
              />
              <span className="text-sm text-slate-700">{o}</span>
            </label>
          ))}
          {field.allowOther && (
            <label className="flex items-start gap-2">
              <input
                name={name}
                type={many ? "checkbox" : "radio"}
                value={OTHER_VALUE}
                onChange={(e) =>
                  many ? setOthers(e.target.checked) : setChoice(OTHER_VALUE)
                }
                className={`mt-0.5 h-4 w-4 border-slate-300 ${many ? "rounded" : ""}`}
              />
              <span className="text-sm text-slate-700">Other…</span>
            </label>
          )}
        </div>
        <OtherInput
          field={field}
          focus={focus}
          show={field.allowOther && (many ? others : choice === OTHER_VALUE)}
        />
      </fieldset>
    );
  }

  if (field.type === "scale") {
    const steps = scaleRange(field);
    return (
      <fieldset>
        <legend className="block">
          <Prompt field={field} />
        </legend>
        <div className="mt-2 flex items-center gap-2">
          {field.minLabel && (
            <span className="shrink-0 text-xs text-slate-500">{field.minLabel}</span>
          )}
          <div className="flex flex-1 justify-between gap-1">
            {steps.map((n) => (
              <label key={n} className="flex flex-col items-center gap-1 text-xs text-slate-600">
                <span>{n}</span>
                <input
                  name={name}
                  type="radio"
                  value={n}
                  required={field.required}
                  className="h-4 w-4 border-slate-300"
                />
              </label>
            ))}
          </div>
          {field.maxLabel && (
            <span className="shrink-0 text-xs text-slate-500">{field.maxLabel}</span>
          )}
        </div>
      </fieldset>
    );
  }

  return (
    <label className="block">
      <Prompt field={field} />
      {field.type === "select" ? (
        <>
          <select
            name={name}
            required={field.required}
            defaultValue=""
            onChange={(e) => setChoice(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {field.allowOther && <option value={OTHER_VALUE}>Other…</option>}
          </select>
          <OtherInput
            field={field}
            focus={focus}
            show={field.allowOther && choice === OTHER_VALUE}
          />
        </>
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
      ) : field.type === "number" ? (
        <input
          name={name}
          type="number"
          inputMode="decimal"
          required={field.required}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          placeholder={field.placeholder ?? undefined}
          className={inputClass}
        />
      ) : field.type === "date" || field.type === "time" ? (
        <input
          name={name}
          type={field.type}
          required={field.required}
          className={inputClass}
        />
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
 * The proof-of-submission ticket. Staff working a prize wheel need to tell a
 * genuine submission from someone who only opened the form, and the leads list
 * is far too slow to police a queue — so everything they check is on this one
 * screen: the code, the name they can match to the person, and a timer that
 * keeps counting. A screenshot borrowed from a friend shows the wrong name and
 * a stale elapsed time.
 */
function VerificationTicket({
  receipt,
  note,
  theme,
}: {
  receipt: CaptureReceipt;
  note: string | null;
  theme: QrFormTheme;
}) {
  const [elapsed, setElapsed] = useState<string | null>(null);

  useEffect(() => {
    const since = new Date(receipt.submittedAt).getTime();
    if (Number.isNaN(since)) return;
    const tick = () => {
      const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
      setElapsed(
        secs < 60
          ? `${secs}s ago`
          : secs < 3600
            ? `${Math.floor(secs / 60)}m ${secs % 60}s ago`
            : `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [receipt.submittedAt]);

  return (
    <div className="mt-6">
      <div className={`rounded-xl border-2 border-dashed p-4 ${theme.ticket}`}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
          Show this screen to a team member
        </p>
        <p
          className={`mt-2 font-mono text-4xl font-black tracking-[0.2em] ${theme.accentText}`}
        >
          {receipt.confirmationCode}
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-900">{receipt.fullName}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Submitted{elapsed ? ` ${elapsed}` : ""}
        </p>
      </div>
      {note && <p className="mt-3 text-xs text-slate-500">{note}</p>}
    </div>
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
  postSubmitHeading,
  showConfirmation,
  confirmationNote,
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
  postSubmitHeading?: string | null;
  showConfirmation?: boolean;
  confirmationNote?: string | null;
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
            {postSubmitHeading?.trim() || "Thanks — you're all set!"}
          </h2>
          {/* The author's own words lead the screen; the fallback stays quiet. */}
          {successMessage?.trim() ? (
            <p className={`mt-3 text-lg font-semibold ${t.accentText}`}>{successMessage}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              The Green Dog Dental team will be in touch shortly.
            </p>
          )}
          {showConfirmation && result.receipt && (
            <VerificationTicket
              receipt={result.receipt}
              note={confirmationNote ?? null}
              theme={t}
            />
          )}
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
