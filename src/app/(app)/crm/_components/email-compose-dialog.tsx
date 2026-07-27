"use client";

import { useState, useTransition } from "react";
import {
  renderTemplate,
  type EmailTemplate,
  type TemplateVars,
} from "@/lib/crm/email-templates";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export type SendResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Generic email compose dialog. Used by any CRM "Send Email" surface. The
 * caller supplies the account label, default recipient, the templates to offer,
 * the variable map used to fill them, and a `sendAction` that performs the
 * actual send (a page-specific server action wrapper).
 */
export function EmailComposeDialog({
  accountName,
  defaultTo,
  templates,
  vars,
  fromNote,
  sendAction,
  onClose,
  onSent,
}: {
  accountName: string;
  defaultTo: string;
  templates: EmailTemplate[];
  vars: TemplateVars;
  /** Optional note under the header, e.g. the From address used. */
  fromNote?: string;
  sendAction: (payload: {
    to: string;
    subject: string;
    body: string;
    templateName: string | null;
  }) => Promise<SendResult>;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [templateId, setTemplateId] = useState<string>("");
  const [to, setTo] = useState<string>(defaultTo);
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject, vars));
    setBody(renderTemplate(t.body, vars));
  }

  function handleSend() {
    setError(null);
    const t = templates.find((x) => x.id === templateId);
    startTransition(async () => {
      const res = await sendAction({
        to: to.trim(),
        subject,
        body,
        templateName: t?.name ?? null,
      });
      if (res.ok) {
        onSent(res.message ?? "Email sent.");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Send Email</h2>
            <p className="mt-0.5 text-sm text-slate-500">{accountName}</p>
            {fromNote && <p className="mt-0.5 text-xs text-slate-400">{fromNote}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-500 hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Template
            </span>
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className={inputCls}
            >
              <option value="">— Choose a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <span className="mt-1 block text-xs text-amber-600">
                No active templates for this partner type. Add one in Admin → Templates.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              To
            </span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Subject
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Message
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Pick a template above, or write your message here."
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-slate-400">
              Personalized from the account. Edit freely before sending.
            </span>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={pending || !to.trim() || !subject.trim() || !body.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
