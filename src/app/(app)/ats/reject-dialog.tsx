"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { REJECTION_DELAY_HOURS, suggestedTemplate, type RejectedFrom } from "@/lib/ats/rejections";
import { rejectCandidate } from "./crm-actions";
import { Modal } from "./candidate-next-steps";

export interface TemplateOption {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Reject → "Send rejection email automatically in 48 hours?" (default yes)
 * with a template → Confirm Rejection. The candidate lands in the Rejected
 * queue, where the email can be cancelled or the rejection undone.
 */
export function RejectDialog({
  personId,
  candidateName,
  hasEmail,
  from,
  templates,
  hadInterview = false,
  onClose,
  onDone,
}: {
  personId: string;
  candidateName: string;
  hasEmail: boolean;
  from: RejectedFrom;
  templates: TemplateOption[];
  hadInterview?: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const active = templates.filter((t) => t.active);
  const [send, setSend] = useState(hasEmail && active.length > 0);
  const [templateId, setTemplateId] = useState(suggestedTemplate(active, from, hadInterview) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal title={`Reject ${candidateName}?`} subtitle="They move to the Rejected queue." onClose={onClose}>
      <div className="space-y-4">
        <label className={`flex items-start gap-2 text-sm ${hasEmail ? "text-slate-800" : "text-slate-400"}`}>
          <input
            type="checkbox"
            checked={send}
            disabled={!hasEmail || active.length === 0}
            onChange={(e) => setSend(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded text-emerald-600"
          />
          <span>
            <span className="font-medium">Send rejection email automatically in {REJECTION_DELAY_HOURS} hours?</span>
            <span className="block text-xs text-slate-500">
              {hasEmail
                ? "You can cancel the email or undo the rejection from the Rejected queue until it sends."
                : "No email address on file — nothing will be sent."}
            </span>
          </span>
        </label>
        {send && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Template</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
            >
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Link href="/ats/settings" className="mt-1 inline-block text-xs text-emerald-700 hover:underline">
              Edit templates
            </Link>
          </label>
        )}
        {active.length === 0 && hasEmail && (
          <p className="text-xs text-amber-700">
            No active rejection templates — add one in{" "}
            <Link href="/ats/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || (send && !templateId)}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await rejectCandidate(personId, { from, sendEmail: send, templateId: send ? templateId : null });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                onDone?.();
                onClose();
              })
            }
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? "Rejecting…" : "Confirm Rejection"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
