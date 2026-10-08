"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column, type FilterDef } from "../_components/data-views";
import { answerText, fieldIsAnswerable, isFileAnswer, type AnswerValue, type RecruitingFormField } from "@/lib/ats/forms";
import { ScoreControl } from "./score-control";
import { RejectDialog, type TemplateOption } from "./reject-dialog";
import {
  Modal,
  ScheduleInvitePanel,
  SendFormPanel,
  type InterviewerOption,
  type ScreeningFormOption,
} from "./candidate-next-steps";
import { markFormReviewed } from "./crm-actions";

export type FormQueueStatus = "waiting" | "needs_review" | "reviewed";

export interface FormQueueRow {
  id: string;
  token: string;
  person_id: string;
  candidate: string;
  has_email: boolean;
  role: string | null;
  job_title: string | null;
  location: string | null;
  score: number | null;
  form_name: string;
  sent_at: string;
  sent_by_name: string | null;
  status: FormQueueStatus;
  completed_at: string | null;
  reviewed_by_name: string | null;
  response: { fields: RecruitingFormField[]; answers: Record<string, AnswerValue> } | null;
}

export const FORM_STATUS_LABELS: Record<FormQueueStatus, string> = {
  waiting: "Waiting for Response",
  needs_review: "Completed — Needs Review",
  reviewed: "Reviewed",
};

const STATUS_BADGE: Record<FormQueueStatus, string> = {
  waiting: "bg-amber-100 text-amber-800",
  needs_review: "bg-violet-100 text-violet-800",
  reviewed: "bg-slate-100 text-slate-600",
};

function fmt(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ResponseDialog({
  row,
  forms,
  interviewers,
  currentUserId,
  templates,
  canEdit,
  onClose,
}: {
  row: FormQueueRow;
  forms: ScreeningFormOption[];
  interviewers: InterviewerOption[];
  currentUserId: string | null;
  templates: TemplateOption[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"view" | "phone" | "in_person" | "form" | "reject">("view");
  const [pending, startTransition] = useTransition();
  const finish = (close = true) =>
    startTransition(async () => {
      if (row.status === "needs_review") await markFormReviewed(row.id);
      router.refresh();
      if (close) onClose();
    });

  if (step === "reject") {
    return (
      <RejectDialog
        personId={row.person_id}
        candidateName={row.candidate}
        hasEmail={row.has_email}
        from="forms"
        templates={templates}
        onClose={onClose}
        onDone={() => finish(false)}
      />
    );
  }

  const title =
    step === "phone"
      ? "Move to Phone Interview"
      : step === "in_person"
        ? "Skip Phone Interview → In-Person"
        : step === "form"
          ? "Send Another Form"
          : row.form_name;

  return (
    <Modal title={title} subtitle={row.candidate} onClose={onClose}>
      {step === "view" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ScoreControl personId={row.person_id} score={row.score} canEdit={canEdit} size="md" />
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}>
              {FORM_STATUS_LABELS[row.status]}
            </span>
            {row.role && <span className="text-xs text-slate-500">{row.role}</span>}
            <Link href={`/ats/${row.person_id}?tab=forms`} className="ml-auto text-xs font-medium text-emerald-700 hover:underline">
              Open profile →
            </Link>
          </div>
          {row.response ? (
            <dl className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              {row.response.fields
                .filter((f) => fieldIsAnswerable(f.type))
                .map((f) => {
                  const v = row.response!.answers[f.id];
                  return (
                    <div key={f.id}>
                      <dt className="text-xs font-semibold text-slate-500">{f.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                        {isFileAnswer(v) ? (
                          <Link href={`/ats/${row.person_id}?tab=documents`} className="text-emerald-700 hover:underline">
                            📎 {v.file_name}
                          </Link>
                        ) : (
                          (answerText(v) ?? <span className="text-slate-400">—</span>)
                        )}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⏳ Sent {fmt(row.sent_at)}{row.sent_by_name ? ` by ${row.sent_by_name}` : ""} — waiting for the candidate to respond.
            </p>
          )}
          {canEdit && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setStep("phone")} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                📞 Move to Phone Interview
              </button>
              <button type="button" onClick={() => setStep("in_person")} className="rounded-lg border border-violet-600 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50">
                👋 Skip → In-Person
              </button>
              <button type="button" onClick={() => setStep("form")} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                📝 Send Another Form
              </button>
              <button type="button" onClick={() => setStep("reject")} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                ✕ Reject
              </button>
              {row.status !== "waiting" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await markFormReviewed(row.id, row.status !== "reviewed");
                      router.refresh();
                      onClose();
                    })
                  }
                  className="col-span-2 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                >
                  {row.status === "reviewed" ? "Mark as needing review" : "✓ Mark reviewed (no action yet)"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {(step === "phone" || step === "in_person") && (
        <ScheduleInvitePanel
          personId={row.person_id}
          interviewers={interviewers}
          currentUserId={currentUserId}
          defaultType={step === "phone" ? "phone_screen" : "in_person"}
          defaultLocation={row.location}
          onDone={() => finish()}
          onBack={() => setStep("view")}
        />
      )}
      {step === "form" && (
        <SendFormPanel
          personId={row.person_id}
          forms={forms}
          jobTitle={row.job_title}
          onDone={() => finish()}
          onBack={() => setStep("view")}
        />
      )}
    </Modal>
  );
}

/**
 * Form Response Queue — everyone sent a role-specific questionnaire: waiting
 * on them, or completed and waiting on us.
 */
export function FormResponsesQueue({
  rows,
  forms,
  interviewers,
  currentUserId,
  templates,
  canEdit,
}: {
  rows: FormQueueRow[];
  forms: ScreeningFormOption[];
  interviewers: InterviewerOption[];
  currentUserId: string | null;
  templates: TemplateOption[];
  canEdit: boolean;
}) {
  const [showReviewed, setShowReviewed] = useState(false);
  const [openRow, setOpenRow] = useState<FormQueueRow | null>(null);
  const visible = rows
    .filter((r) => showReviewed || r.status !== "reviewed")
    .sort(
      (a, b) =>
        Number(b.status === "needs_review") - Number(a.status === "needs_review") ||
        (b.completed_at ?? b.sent_at).localeCompare(a.completed_at ?? a.sent_at),
    );
  const needsReview = rows.filter((r) => r.status === "needs_review").length;
  const waiting = rows.filter((r) => r.status === "waiting").length;

  const columns: Column<FormQueueRow>[] = [
    {
      key: "candidate",
      header: "Candidate",
      value: (r) => r.candidate,
      render: (r) => <span className="font-medium text-slate-900">{r.candidate}</span>,
    },
    { key: "role", header: "Role", value: (r) => r.role },
    { key: "location", header: "Location", value: (r) => r.location },
    {
      key: "score",
      header: "Score",
      value: (r) => r.score,
      render: (r) => <ScoreControl personId={r.person_id} score={r.score} canEdit={canEdit} />,
    },
    { key: "form", header: "Form Sent", value: (r) => r.form_name },
    { key: "sent", header: "Date Sent", value: (r) => r.sent_at, render: (r) => fmt(r.sent_at) },
    {
      key: "status",
      header: "Response Status",
      value: (r) => FORM_STATUS_LABELS[r.status],
      render: (r) => (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>
          {FORM_STATUS_LABELS[r.status]}
        </span>
      ),
    },
    {
      key: "completed",
      header: "Date Completed",
      value: (r) => r.completed_at,
      render: (r) => fmt(r.completed_at) ?? <span className="text-slate-400">—</span>,
    },
  ];
  const filters: FilterDef<FormQueueRow>[] = [
    { key: "status", label: "Status", value: (r) => FORM_STATUS_LABELS[r.status] },
    { key: "form", label: "Form", value: (r) => r.form_name },
    { key: "role", label: "Role", value: (r) => r.role },
    { key: "location", label: "Location", value: (r) => r.location },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-violet-700">{needsReview}</span> completed and need review ·{" "}
          <span className="font-semibold text-amber-700">{waiting}</span> waiting for a response
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
          Show reviewed
        </label>
      </div>
      <DataTable
        rows={visible}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search candidate, form, role…"
        onRowClick={(r) => setOpenRow(r)}
        emptyLabel="No questionnaires waiting. Send one from a candidate's Forms tab or right after approving them."
      />
      {openRow && (
        <ResponseDialog
          key={openRow.id}
          row={openRow}
          forms={forms}
          interviewers={interviewers}
          currentUserId={currentUserId}
          templates={templates}
          canEdit={canEdit}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}
