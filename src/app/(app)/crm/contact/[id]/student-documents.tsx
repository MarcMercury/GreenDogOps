"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { CrmContactDocumentWithUrl } from "@/lib/crm/types";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/hr/types";
import {
  uploadContactDocument,
  deleteContactDocument,
  type SaveResult,
} from "../../actions";

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}

export function StudentDocuments({
  contactId,
  documents,
  canEdit,
}: {
  contactId: string;
  documents: CrmContactDocumentWithUrl[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => uploadContactDocument(contactId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Documents
      </h2>
      <p className="mb-4 text-xs text-slate-400">
        Attachments here follow the student into the Recruiting (ATS) and
        HR/Roster profiles when the record is promoted.
      </p>

      {canEdit && (
        <form
          ref={formRef}
          action={formAction}
          className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Title</span>
            <input
              name="title"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Category</span>
            <select
              name="category"
              defaultValue=""
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">—</option>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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
            <UploadButton />
            <span className="text-xs text-slate-400">Max 25 MB.</span>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      )}

      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No documents uploaded yet.
        </p>
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
              {canEdit && (
                <DeleteDocButton
                  onDelete={() =>
                    deleteContactDocument(contactId, d.id, d.storage_path)
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeleteDocButton({
  onDelete,
}: {
  onDelete: () => Promise<SaveResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this document? This cannot be undone."))
            return;
          startTransition(async () => {
            const res = await onDelete();
            setError(res.ok ? null : res.error);
          });
        }}
        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
