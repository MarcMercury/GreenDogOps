"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type CandidateRow, type CandidateDocument } from "@/lib/ats/types";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/hr/types";
import { acceptCandidate, declineCandidate, getCandidateDocuments } from "./actions";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unnamed applicant";
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtBytes(n: number | null): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function docLabel(d: CandidateDocument): string {
  if (d.category && DOCUMENT_CATEGORY_LABELS[d.category]) {
    return DOCUMENT_CATEGORY_LABELS[d.category];
  }
  return d.title || d.file_name || "Attachment";
}

// Matches bare http(s) URLs so we can turn them into a compact "Resume" link.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Render free-text application notes, replacing any bare URL (typically the
 * candidate's resume link on non-Indeed submissions) with a compact hyperlink
 * labelled "Resume" instead of showing the full, unwieldy URL.
 */
function renderNotesWithLinks(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-emerald-700 hover:underline"
      >
        Resume
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/**
 * Intake review queue: auto-ingested applicants (Gmail / Indeed) awaiting a
 * recruiter's accept or reject decision. Accepting promotes them to an active
 * lead; rejecting marks them Declined (kept for re-apply detection).
 */
export function IntakeReview({ rows }: { rows: CandidateRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = rows.filter((r) => !done.has(r.id));

  function act(id: string, fn: (personId: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn(id);
      if (res.ok) {
        setDone((prev) => new Set(prev).add(id));
        router.refresh();
      } else {
        setError(res.error);
      }
      setBusyId(null);
    });
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <div className="text-3xl">✅</div>
        <p className="mt-2 text-sm font-medium text-slate-700">Review queue is clear</p>
        <p className="mt-1 text-xs text-slate-500">
          New applications from Gmail and Indeed will appear here for a quick accept or reject.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {visible.map((r) => (
        <ReviewCard
          key={r.id}
          row={r}
          busy={busyId === r.id && isPending}
          onAccept={() => act(r.id, acceptCandidate)}
          onDecline={() => act(r.id, declineCandidate)}
        />
      ))}
    </div>
  );
}

/**
 * A single applicant tile in the review queue. Collapsed it shows the name,
 * source, position and contact line; expanded it reveals the full application
 * details (cover letter / screener answers already captured in the recruiting
 * notes), every contact field, and any attached documents (resume, etc.),
 * which are fetched on demand the first time the card is opened.
 */
function ReviewCard({
  row: r,
  busy,
  onAccept,
  onDecline,
}: {
  row: CandidateRow;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<CandidateDocument[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const rec = r.person_recruiting;
  const source = rec?.source ?? "—";
  const applied = fmtDate(rec?.application_date) ?? fmtDate(r.created_at);
  const isReapply = (rec?.notes ?? "").includes("Re-applied");
  const noContact = !r.email && !r.phone_mobile;
  const phones = [r.phone_mobile, r.phone_home, r.phone_other].filter(Boolean) as string[];

  function toggle() {
    const next = !open;
    setOpen(next);
    // Lazy-load attachments the first time the card is opened.
    if (next && docs === null && !docsLoading) {
      setDocsLoading(true);
      setDocsError(null);
      getCandidateDocuments(r.id)
        .then((res) => {
          if (res.ok) setDocs(res.documents);
          else setDocsError(res.error);
        })
        .catch((e) => setDocsError(e instanceof Error ? e.message : "Could not load attachments."))
        .finally(() => setDocsLoading(false));
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="shrink-0 rounded-md p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title={open ? "Hide details" : "Show details"}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggle}
              className="truncate text-left font-semibold text-slate-900 hover:text-emerald-700"
            >
              {candidateName(r)}
            </button>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                source === "Indeed"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {source}
            </span>
            {isReapply && (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                🔁 Re-applied
              </span>
            )}
          </div>

          <div className="mt-1 text-sm text-slate-700">
            <span className="font-medium">
              {rec?.target_title ?? "Position not specified"}
            </span>
            {applied && <span className="text-slate-400"> · applied {applied}</span>}
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            {r.email && <span>✉️ {r.email}</span>}
            {r.phone_mobile && <span>📞 {r.phone_mobile}</span>}
            {noContact && (
              <span className="italic text-slate-400">
                No contact info in email — expand for the full application
              </span>
            )}
          </div>

          {!open && rec?.notes && (
            <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-slate-500">{rec.notes}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "…" : "✓ Accept"}
          </button>
          <button
            onClick={onDecline}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            {busy ? "…" : "✕ Reject"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          {/* Contact details */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Contact
            </h4>
            <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-slate-400">Email</dt>
                <dd className="min-w-0 break-words">
                  {r.email ? (
                    <a href={`mailto:${r.email}`} className="text-emerald-700 hover:underline">
                      {r.email}
                    </a>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-slate-400">Phone</dt>
                <dd className="min-w-0">
                  {phones.length ? (
                    phones.map((p, i) => (
                      <span key={p}>
                        {i > 0 && ", "}
                        <a href={`tel:${p}`} className="text-emerald-700 hover:underline">
                          {p}
                        </a>
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </dd>
              </div>
              {r.postal_code && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">Postal</dt>
                  <dd>{r.postal_code}</dd>
                </div>
              )}
              {r.date_of_birth && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">DOB</dt>
                  <dd>{fmtDate(r.date_of_birth)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Application details — cover letter + screener answers */}
          {rec?.notes && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Application details
              </h4>
              <p className="mt-1.5 max-w-3xl whitespace-pre-wrap text-sm text-slate-700">
                {renderNotesWithLinks(rec.notes)}
              </p>
            </div>
          )}

          {/* Attachments */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Attachments
            </h4>
            {docsLoading && (
              <p className="mt-1.5 text-sm text-slate-400">Loading attachments…</p>
            )}
            {docsError && <p className="mt-1.5 text-sm text-rose-600">{docsError}</p>}
            {!docsLoading && !docsError && docs && docs.length === 0 && (
              <p className="mt-1.5 text-sm text-slate-400">
                No documents attached. Resumes sent with the application are attached automatically.
              </p>
            )}
            {docs && docs.length > 0 && (
              <ul className="mt-1.5 space-y-1.5">
                {docs.map((d) => {
                  const size = fmtBytes(d.size_bytes);
                  return (
                    <li key={d.id}>
                      {d.signed_url ? (
                        <a
                          href={d.signed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                        >
                          📎 <span className="font-medium">{docLabel(d)}</span>
                          {d.file_name && d.file_name !== docLabel(d) && (
                            <span className="text-slate-400">· {d.file_name}</span>
                          )}
                          {size && <span className="text-slate-400">· {size}</span>}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400">
                          📎 {docLabel(d)} (link unavailable)
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="pt-1">
            <Link
              href={`/ats/${r.id}`}
              className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
            >
              Open full profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
