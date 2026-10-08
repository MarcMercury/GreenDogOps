"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column, type FilterDef } from "../_components/data-views";
import {
  REJECTED_FROM_LABELS,
  REJECTION_EMAIL_STATUS_BADGE,
  REJECTION_EMAIL_STATUS_LABELS,
  canUndoRejection,
  countdown,
  type Rejection,
} from "@/lib/ats/rejections";
import { cancelRejectionEmail, undoRejection } from "./crm-actions";

export interface RejectedRow extends Rejection {
  candidate: string;
  role: string | null;
  /** False once they've been moved on (re-applied, restaged by hand…). */
  still_rejected: boolean;
}

function fmt(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Actions({ r, canEdit }: { r: RejectedRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!canEdit) return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, confirmText: string) => {
    if (!confirm(confirmText)) return;
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };
  return (
    <span className="flex flex-wrap items-center justify-end gap-3 text-xs font-medium" onClick={(e) => e.stopPropagation()}>
      {r.email_status === "scheduled" && r.still_rejected && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => cancelRejectionEmail(r.id), `Cancel the rejection email to ${r.candidate}? They stay rejected.`)}
          className="text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          Cancel email
        </button>
      )}
      {!r.still_rejected && <span className="text-slate-400">Moved on since</span>}
      {r.still_rejected && canUndoRejection(r) && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => undoRejection(r.id),
              `Undo the rejection? ${r.candidate} goes back to ${r.prev_review_status === "pending" ? "the Review Queue" : `stage “${r.prev_stage ?? "none"}”`} and no email is sent. Cancelled links and interviews stay cancelled.`,
            )
          }
          className="text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
        >
          Undo rejection
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}

/**
 * Rejected — candidates in the 48-hour window before their rejection email,
 * and those already emailed. The window is the safety net: cancel the email
 * or undo the rejection until it sends.
 */
export function RejectedQueue({ rows, canEdit }: { rows: RejectedRow[]; canEdit: boolean }) {
  const router = useRouter();
  const waiting = rows.filter((r) => r.email_status === "scheduled").length;
  const columns: Column<RejectedRow>[] = [
    {
      key: "candidate",
      header: "Candidate",
      value: (r) => r.candidate,
      render: (r) => <span className="font-medium text-slate-900">{r.candidate}</span>,
    },
    { key: "role", header: "Role", value: (r) => r.role },
    {
      key: "from",
      header: "Stage Rejected From",
      value: (r) => REJECTED_FROM_LABELS[r.rejected_from] ?? r.rejected_from,
      render: (r) => (
        <span>
          {REJECTED_FROM_LABELS[r.rejected_from] ?? r.rejected_from}
          {r.prev_stage && <span className="block text-xs text-slate-400">was {r.prev_stage}</span>}
        </span>
      ),
    },
    { key: "by", header: "Rejected By", value: (r) => r.rejected_by_name },
    { key: "date", header: "Rejection Date", value: (r) => r.rejected_at, render: (r) => fmt(r.rejected_at) },
    {
      key: "scheduled",
      header: "Email Scheduled For",
      value: (r) => r.email_scheduled_for,
      render: (r) =>
        r.email_scheduled_for ? (
          <span>
            {fmt(r.email_scheduled_for)}
            {r.email_status === "scheduled" && (
              <span className="block text-xs font-medium text-amber-700">{countdown(r.email_scheduled_for)}</span>
            )}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "template", header: "Email Template", value: (r) => r.template_name ?? (r.send_email ? null : "No email") },
    {
      key: "status",
      header: "Email Status",
      value: (r) => REJECTION_EMAIL_STATUS_LABELS[r.email_status],
      render: (r) => (
        <span title={r.email_error ?? undefined} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${REJECTION_EMAIL_STATUS_BADGE[r.email_status]}`}>
          {REJECTION_EMAIL_STATUS_LABELS[r.email_status]}
        </span>
      ),
    },
    { key: "actions", header: "", value: () => null, sortable: false, render: (r) => <Actions r={r} canEdit={canEdit} /> },
  ];
  const filters: FilterDef<RejectedRow>[] = [
    { key: "status", label: "Email status", value: (r) => REJECTION_EMAIL_STATUS_LABELS[r.email_status] },
    { key: "from", label: "Rejected from", value: (r) => REJECTED_FROM_LABELS[r.rejected_from] },
    { key: "template", label: "Template", value: (r) => r.template_name },
    { key: "role", label: "Role", value: (r) => r.role },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-amber-700">{waiting}</span> in the 48-hour window. Emails send automatically when
          the window ends.
        </p>
        <Link href="/ats/settings" className="text-sm font-medium text-emerald-700 hover:underline">
          ⚙ Rejection templates
        </Link>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search candidate, role…"
        onRowClick={(r) => router.push(`/ats/${r.person_id}`)}
        emptyLabel="No rejections yet."
      />
    </div>
  );
}
