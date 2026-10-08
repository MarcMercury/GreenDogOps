"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renderTemplate, type EmailTemplate } from "@/lib/ats/rejections";
import { saveRejectionTemplate } from "../crm-actions";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const SAMPLE = { first_name: "Jane", full_name: "Jane Doe", role: "CSR" };

type Draft = { id: string | null; name: string; subject: string; body: string; active: boolean };

function Editor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-500">
          Template name
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={`${inputCls} mt-1`} placeholder="Post-Interview Rejection" />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Email subject
          <input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} className={`${inputCls} mt-1`} />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-500">
        Message
        <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={9} className={`${inputCls} mt-1 font-mono text-[13px]`} />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="h-4 w-4 rounded text-emerald-600" />
        Active (offered when rejecting)
      </label>
      {preview && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="mb-2 font-semibold">{renderTemplate(d.subject, SAMPLE)}</p>
          <p className="whitespace-pre-wrap">{renderTemplate(d.body, SAMPLE)}</p>
          <p className="mt-3 text-slate-500">— The Green Dog Team</p>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => setPreview((p) => !p)} className="text-sm font-medium text-slate-600 hover:text-slate-900">
          {preview ? "Hide preview" : "Preview (Jane Doe, CSR)"}
        </button>
        <span className="flex gap-2">
          <button type="button" onClick={onDone} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await saveRejectionTemplate(d);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                router.refresh();
                onDone();
              })
            }
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </span>
      </div>
    </div>
  );
}

export function TemplatesEditor({ templates, canEdit }: { templates: EmailTemplate[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="mt-4 space-y-3">
      {templates.map((t) =>
        editing === t.id ? (
          <Editor key={t.id} draft={{ id: t.id, name: t.name, subject: t.subject, body: t.body, active: t.active }} onDone={() => setEditing(null)} />
        ) : (
          <div key={t.id} className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${t.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">
                {t.name}
                {!t.active && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Inactive</span>}
              </p>
              {canEdit && (
                <button type="button" onClick={() => setEditing(t.id)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900">
                  Edit
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">Subject: {t.subject}</p>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{t.body}</p>
          </div>
        ),
      )}
      {canEdit &&
        (editing === "new" ? (
          <Editor draft={{ id: null, name: "", subject: "Your application to Green Dog", body: "Hi {first_name},\n\n", active: true }} onDone={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            + Template
          </button>
        ))}
    </div>
  );
}
