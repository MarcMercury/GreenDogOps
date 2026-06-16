"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type {
  RosterRow,
  PersonReview,
  PersonAsset,
  PersonDocumentWithUrl,
  PersonRecruitingSummary,
} from "@/lib/hr/types";
import {
  REVIEW_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  ASSET_STATUS_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  STATUS_LABELS,
} from "@/lib/hr/types";
import {
  saveReview,
  deleteReview,
  saveAsset,
  deleteAsset,
  uploadDocument,
  deleteDocument,
  type SaveResult,
} from "../actions";
import {
  EmployeeForm,
  Field,
  Select,
  Section,
  type FieldTab,
} from "./employee-form";

type TabKey =
  | FieldTab
  | "reviews"
  | "documents"
  | "assets"
  | "history";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "comp", label: "Compensation & Benefits" },
  { key: "attendance", label: "Attendance" },
  { key: "reviews", label: "Reviews" },
  { key: "documents", label: "Documents" },
  { key: "assets", label: "Assets" },
  { key: "history", label: "History" },
];

const FIELD_TABS: TabKey[] = ["general", "comp", "attendance"];

function isFieldTab(tab: TabKey): tab is FieldTab {
  return FIELD_TABS.includes(tab);
}

export function EmployeeProfile({
  row,
  reviews,
  assets,
  documents,
  recruiting,
}: {
  row: RosterRow;
  reviews: PersonReview[];
  assets: PersonAsset[];
  documents: PersonDocumentWithUrl[];
  recruiting: PersonRecruitingSummary | null;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.grid_name ||
    "Employee";

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {heading}
        </h1>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          {STATUS_LABELS[row.status] ?? row.status}
        </span>
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Field tabs stay mounted so unsaved edits survive tab switches. */}
      <EmployeeForm
        row={row}
        activeTab={isFieldTab(activeTab) ? activeTab : "general"}
        hidden={!isFieldTab(activeTab)}
      />

      {activeTab === "reviews" && (
        <ReviewsPanel personId={row.id} reviews={reviews} />
      )}
      {activeTab === "documents" && (
        <DocumentsPanel personId={row.id} documents={documents} />
      )}
      {activeTab === "assets" && (
        <AssetsPanel personId={row.id} assets={assets} />
      )}
      {activeTab === "history" && (
        <HistoryPanel row={row} recruiting={recruiting} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AddButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function DeleteButton({
  onConfirm,
  label = "this item",
}: {
  onConfirm: () => void;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          start(() => onConfirm());
        }
      }}
      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

function ReviewsPanel({
  personId,
  reviews,
}: {
  personId: string;
  reviews: PersonReview[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveReview(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Log a review">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Review date" name="review_date" type="date" />
          <Select
            label="Type"
            name="review_type"
            options={Object.entries(REVIEW_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Field label="Reviewer" name="reviewer" />
          <Field label="Rating / score" name="rating" placeholder="e.g. Exceeds, 4/5" />
          <Field label="Next review date" name="next_review_date" type="date" />
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-slate-500">Summary</span>
            <textarea
              name="summary"
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Add review</AddButton>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {reviews.length === 0 ? (
        <EmptyState>No reviews logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {r.review_type
                      ? (REVIEW_TYPE_LABELS[r.review_type] ?? r.review_type)
                      : "Review"}
                    {r.rating ? ` · ${r.rating}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.review_date)}
                    {r.reviewer ? ` · ${r.reviewer}` : ""}
                    {r.next_review_date
                      ? ` · next: ${fmtDate(r.next_review_date)}`
                      : ""}
                  </p>
                </div>
                <DeleteButton
                  label="this review"
                  onConfirm={() => deleteReview(personId, r.id)}
                />
              </div>
              {r.summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {r.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsPanel({
  personId,
  documents,
}: {
  personId: string;
  documents: PersonDocumentWithUrl[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => uploadDocument(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Upload a document">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Title" name="title" placeholder="e.g. Signed offer letter" />
          <Select
            label="Category"
            name="category"
            options={Object.entries(DOCUMENT_CATEGORY_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">File</span>
            <input
              name="file"
              type="file"
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Upload</AddButton>
            <span className="text-xs text-slate-400">Max 25 MB.</span>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {documents.length === 0 ? (
        <EmptyState>No documents uploaded yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {d.signed_url ? (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:text-emerald-900 hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {d.category
                    ? (DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category)
                    : "Uncategorized"}
                  {d.file_name ? ` · ${d.file_name}` : ""}
                  {d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}
                  {` · ${fmtDate(d.uploaded_at)}`}
                </p>
              </div>
              <DeleteButton
                label="this document"
                onConfirm={() => deleteDocument(personId, d.id, d.storage_path)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function AssetsPanel({
  personId,
  assets,
}: {
  personId: string;
  assets: PersonAsset[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveAsset(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Assign an asset">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Asset name" name="asset_name" placeholder="e.g. MacBook Air" />
          <Select
            label="Type"
            name="asset_type"
            options={Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Field label="Serial / tag" name="identifier" />
          <Field label="Assigned date" name="assigned_date" type="date" />
          <Field label="Returned date" name="returned_date" type="date" />
          <Select
            label="Status"
            name="status"
            defaultValue="assigned"
            options={Object.entries(ASSET_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-slate-500">Notes</span>
            <textarea
              name="notes"
              rows={2}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Add asset</AddButton>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {assets.length === 0 ? (
        <EmptyState>No assets assigned yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {assets.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {a.asset_name}
                    {a.asset_type
                      ? ` · ${ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}`
                      : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.identifier ? `#${a.identifier} · ` : ""}
                    {`Assigned ${fmtDate(a.assigned_date)}`}
                    {a.returned_date ? ` · Returned ${fmtDate(a.returned_date)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {ASSET_STATUS_LABELS[a.status] ?? a.status}
                  </span>
                  <DeleteButton
                    label="this asset"
                    onConfirm={() => deleteAsset(personId, a.id)}
                  />
                </div>
              </div>
              {a.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {a.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (read-only recruiting summary, carried over from the ATS record)
// ---------------------------------------------------------------------------

function HistoryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function HistoryPanel({
  row,
  recruiting,
}: {
  row: RosterRow;
  recruiting: PersonRecruitingSummary | null;
}) {
  const emp = row.person_employment;

  return (
    <div className="space-y-5">
      <Section title="Employment timeline">
        <dl className="sm:col-span-2 lg:col-span-3">
          <HistoryRow label="Current status" value={STATUS_LABELS[row.status] ?? row.status} />
          <HistoryRow label="Original hire date" value={fmtDate(emp?.original_hire_date ?? null)} />
          <HistoryRow label="Hire date" value={fmtDate(emp?.hire_date ?? null)} />
          <HistoryRow label="Separation date" value={fmtDate(emp?.separation_date ?? null)} />
          <HistoryRow label="Record created" value={fmtDate(row.created_at)} />
        </dl>
      </Section>

      <Section title="Recruiting history">
        {recruiting ? (
          <dl className="sm:col-span-2 lg:col-span-3">
            <HistoryRow label="Pipeline" value={recruiting.pipeline} />
            <HistoryRow label="Final stage" value={recruiting.stage} />
            <HistoryRow label="Source" value={recruiting.source} />
            <HistoryRow label="Interview date" value={fmtDate(recruiting.interview_date)} />
            <HistoryRow
              label="Score"
              value={recruiting.score != null ? String(recruiting.score) : null}
            />
            <HistoryRow
              label="Resume"
              value={
                recruiting.resume_url ? (
                  <a
                    href={recruiting.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 hover:underline"
                  >
                    View resume
                  </a>
                ) : null
              }
            />
            <HistoryRow label="Status notes" value={recruiting.status_notes} />
            <HistoryRow label="Recruiter notes" value={recruiting.notes} />
          </dl>
        ) : (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState>
              No recruiting record found for this person. History is captured
              automatically when an applicant/candidate is converted to an employee.
            </EmptyState>
          </div>
        )}
      </Section>
    </div>
  );
}
