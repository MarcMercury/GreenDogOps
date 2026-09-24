"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import {
  type QrCode,
  type QrForm,
  type QrFormField,
  type QrLead,
  type QrSubject,
  QR_FIELD_TYPES,
  qrPublicUrl,
  slugifyFieldKey,
} from "@/lib/marketing/qr";
import {
  createQrCodeFor,
  deleteQrCode,
  saveQrCode,
  saveQrForm,
  setQrCodeActive,
} from "@/app/(app)/marketing/qr-actions";

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

type ActionOutcome = { ok: boolean; message?: string; error?: string };

/** Self-contained runner so every host dialog gets the same behaviour. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const run = (action: () => Promise<ActionOutcome>) => {
    startTransition(async () => {
      const res = await action();
      setNote(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) router.refresh();
    });
  };

  return { run, pending, note };
}

type Run = ReturnType<typeof useRun>["run"];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * The "QR Code" tab shared by events, CE courses, promotions, referral clinics
 * and rescues. Everything posts through explicit FormData because this panel
 * can live inside a host <form> — no nested <form>, no stray `name` attributes.
 */
export function QrPanel({
  subject,
  codes,
  forms,
  leads = [],
  canEdit,
  emptyHint,
}: {
  subject: QrSubject | null;
  codes: QrCode[];
  forms: QrForm[];
  leads?: QrLead[];
  canEdit: boolean;
  /** Shown when the record has not been saved yet. */
  emptyHint?: string;
}) {
  const { run, pending, note } = useRun();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // Browser-only value, read after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  if (!subject) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
        {emptyHint ??
          "Save this record first — then you can generate its QR code and capture form here."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {codes.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
          <p className="text-sm text-slate-600">
            No QR code yet. Generate one and we&apos;ll create a starter capture form
            with it — every scan lands back here and in QR Code Mgmt.
          </p>
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => createQrCodeFor(subject.kind, subject.id, subject.name))}
              className={`${btnPrimary} mt-3`}
            >
              Create QR code &amp; form
            </button>
          )}
        </div>
      )}

      {codes.map((code) => (
        <QrCodeCard
          key={code.id}
          code={code}
          forms={forms}
          origin={origin}
          canEdit={canEdit}
          run={run}
        />
      ))}

      {codes.length > 0 && canEdit && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => createQrCodeFor(subject.kind, subject.id, subject.name))}
            className={btnGhost}
          >
            ＋ Add another code
          </button>
          <Link
            href="/marketing?tab=qr_codes"
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            Manage all QR codes →
          </Link>
        </div>
      )}

      {leads.length > 0 && <RecentScans leads={leads} />}

      {note && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            note.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function RecentScans({ leads }: { leads: QrLead[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Recent scans ({leads.length})
      </p>
      <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
        {leads.slice(0, 50).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="flex-1 font-medium text-slate-700">{l.full_name}</span>
            <span className="text-xs text-slate-500">
              {[l.email, l.phone].filter(Boolean).join(" · ") || "—"}
            </span>
            <span className="text-[11px] text-slate-400">{fmtDateTime(l.scanned_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QrCodeCard({
  code,
  forms,
  origin,
  canEdit,
  run,
}: {
  code: QrCode;
  forms: QrForm[];
  origin: string;
  canEdit: boolean;
  run: Run;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const url = origin ? qrPublicUrl(origin, code) : "";
  const linkedForm = forms.find((f) => f.id === code.form_id) ?? null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the link:", url);
    }
  }

  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const slug = code.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "qr";
    const link = document.createElement("a");
    link.download = `${slug}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div ref={qrRef} className="mx-auto shrink-0 rounded-lg border border-slate-200 p-2 sm:mx-0">
          {url ? (
            <QRCodeCanvas value={url} size={150} marginSize={2} level="M" />
          ) : (
            <div className="h-[150px] w-[150px]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">{code.label}</p>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                code.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {code.active ? "Active" : "Inactive"}
            </span>
            <span className="text-[11px] text-slate-400">{code.scan_count} scans</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
            <button type="button" onClick={copy} className={btnGhost}>
              {copied ? "✓ Copied" : "Copy link"}
            </button>
            <button type="button" onClick={download} className={btnGhost}>
              Download QR
            </button>
          </div>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => run(() => setQrCodeActive(code.id, !code.active))}
                className="font-medium text-slate-500 hover:text-slate-800"
              >
                {code.active ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete the QR code "${code.label}"? Printed copies stop working.`)) {
                    run(() => deleteQrCode(code.id));
                  }
                }}
                className="font-medium text-red-600 hover:text-red-700"
              >
                Delete code
              </button>
            </div>
          )}
        </div>
      </div>

      <QrFormEditor
        key={code.form_id ?? "none"}
        code={code}
        form={linkedForm}
        forms={forms}
        canEdit={canEdit}
        run={run}
      />
    </div>
  );
}

type FormDraft = {
  name: string;
  headline: string;
  intro: string;
  success_message: string;
  collect_pet_name: boolean;
  collect_zip: boolean;
  fields: QrFormField[];
};

function QrFormEditor({
  code,
  form,
  forms,
  canEdit,
  run,
}: {
  code: QrCode;
  form: QrForm | null;
  forms: QrForm[];
  canEdit: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => ({
    name: form?.name ?? code.label,
    headline: form?.headline ?? "",
    intro: form?.intro ?? "",
    success_message: form?.success_message ?? "",
    collect_pet_name: form?.collect_pet_name ?? true,
    collect_zip: form?.collect_zip ?? false,
    fields: form?.fields ?? [],
  }));

  function patch(p: Partial<FormDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }
  function patchField(idx: number, p: Partial<QrFormField>) {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)),
    }));
  }

  function save() {
    // No theme/banner keys here on purpose — saveQrForm leaves the branding set
    // in QR Code Mgmt → Forms untouched when they are absent.
    const fd = new FormData();
    if (form) fd.set("id", form.id);
    fd.set("name", draft.name);
    fd.set("headline", draft.headline);
    fd.set("intro", draft.intro);
    fd.set("success_message", draft.success_message);
    if (draft.collect_pet_name) fd.set("collect_pet_name", "true");
    if (draft.collect_zip) fd.set("collect_zip", "true");
    fd.set("active", "true");
    fd.set(
      "fields_json",
      JSON.stringify(
        draft.fields
          .filter((f) => f.label.trim())
          .map((f) => ({ ...f, key: f.key || slugifyFieldKey(f.label) })),
      ),
    );
    run(() => saveQrForm(fd));
  }

  function linkForm(formId: string) {
    const fd = new FormData();
    fd.set("id", code.id);
    fd.set("label", code.label);
    fd.set("code_type", code.code_type);
    if (code.event_id) fd.set("event_id", code.event_id);
    if (code.ce_event_id) fd.set("ce_event_id", code.ce_event_id);
    if (code.promotion_id) fd.set("promotion_id", code.promotion_id);
    if (code.org_id) fd.set("org_id", code.org_id);
    if (code.referral_partner_id) fd.set("referral_partner_id", code.referral_partner_id);
    if (code.target_url) fd.set("target_url", code.target_url);
    if (code.notes) fd.set("notes", code.notes);
    fd.set("form_id", formId);
    fd.set("active", String(code.active));
    run(() => saveQrCode(fd));
  }

  if (!form) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-sm text-slate-600">
          No capture form attached — scans see the standard name / email / phone form.
        </p>
        {canEdit && forms.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => e.target.value && linkForm(e.target.value)}
            className={`${fieldInput} mt-2 max-w-xs`}
          >
            <option value="">Attach an existing form…</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capture form</p>
        {canEdit && (
          <button type="button" onClick={save} className={btnPrimary}>
            Save form
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>Form name (internal)</label>
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className={fieldInput}
          />
        </div>
        <div>
          <label className={fieldLabel}>Headline (shown on the page)</label>
          <input
            value={draft.headline}
            onChange={(e) => patch({ headline: e.target.value })}
            className={fieldInput}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Intro text</label>
          <textarea
            value={draft.intro}
            onChange={(e) => patch({ intro: e.target.value })}
            rows={2}
            className={fieldInput}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Thank-you message</label>
          <input
            value={draft.success_message}
            onChange={(e) => patch({ success_message: e.target.value })}
            className={fieldInput}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={draft.collect_pet_name}
            onChange={(e) => patch({ collect_pet_name: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Ask for pet name
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={draft.collect_zip}
            onChange={(e) => patch({ collect_zip: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Ask for ZIP code
        </label>
        <span className="text-xs text-slate-400">Name + email/phone are always collected.</span>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Custom questions
        </p>
        <ul className="space-y-2">
          {draft.fields.map((f, idx) => (
            <li key={idx} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={f.label}
                  onChange={(e) => patchField(idx, { label: e.target.value })}
                  placeholder="Question…"
                  className="min-w-[10rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none"
                />
                <select
                  value={f.type}
                  onChange={(e) => patchField(idx, { type: e.target.value as QrFormField["type"] })}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                >
                  {QR_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => patchField(idx, { required: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      fields: prev.fields.filter((_, i) => i !== idx),
                    }))
                  }
                  className="px-1 text-slate-300 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
              {f.type === "select" && (
                <input
                  value={f.options.join(", ")}
                  onChange={(e) =>
                    patchField(idx, {
                      options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  placeholder="Options, comma separated"
                  className="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none"
                />
              )}
            </li>
          ))}
          {draft.fields.length === 0 && (
            <li className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400">
              No extra questions — the form just collects contact details.
            </li>
          )}
        </ul>
        {canEdit && (
          <button
            type="button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                fields: [
                  ...prev.fields,
                  { key: "", label: "", type: "text", required: false, options: [], placeholder: null },
                ],
              }))
            }
            className={`${btnGhost} mt-2`}
          >
            ＋ Add question
          </button>
        )}
      </div>
    </div>
  );
}
