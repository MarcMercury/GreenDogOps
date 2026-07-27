"use client";

import { useMemo, useState, useTransition } from "react";
import type { ReferralPartner, PartnerContact } from "@/lib/crm/referral-types";
import {
  buildReferralTemplateVars,
  renderTemplate,
  type EmailTemplate,
} from "@/lib/crm/email-templates";
import { sendReferralEmail } from "./actions";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export function EmailComposeDialog({
  partner,
  contacts,
  templates,
  senderName,
  senderEmail,
  onClose,
  onSent,
}: {
  partner: ReferralPartner;
  contacts: PartnerContact[];
  templates: EmailTemplate[];
  senderName: string | null;
  senderEmail: string | null;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const primaryContactEmail = useMemo(() => {
    const primary = contacts.find((c) => c.is_primary && c.email);
    return primary?.email ?? contacts.find((c) => c.email)?.email ?? null;
  }, [contacts]);

  const vars = useMemo(
    () => buildReferralTemplateVars(partner, { name: senderName, email: senderEmail }),
    [partner, senderName, senderEmail],
  );

  const [templateId, setTemplateId] = useState<string>("");
  const [to, setTo] = useState<string>(partner.email ?? primaryContactEmail ?? "");
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
    const fd = new FormData();
    fd.set("partnerId", partner.id);
    fd.set("to", to.trim());
    fd.set("subject", subject);
    fd.set("body", body);
    if (t) fd.set("templateName", t.name);
    startTransition(async () => {
      const res = await sendReferralEmail(fd);
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
            <p className="mt-0.5 text-sm text-slate-500">{partner.name ?? partner.hospital_name}</p>
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
                No active templates. Add one in Admin → Templates.
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
              placeholder="recipient@clinic.com"
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
