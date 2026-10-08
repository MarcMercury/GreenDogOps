"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type CandidateRow,
  type CandidateDocument,
  type PositionRow,
  positionLabel,
} from "@/lib/ats/types";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/hr/types";
import { acceptCandidate, declineCandidate, getCandidateDocuments } from "./actions";
import {
  ApprovedNextStepDialog,
  type InterviewerOption,
  type ScreeningFormOption,
} from "./candidate-next-steps";

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

function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Weekdays after `from` up to and including `to` (both yyyy-mm-dd). */
function businessDaysBetween(from: string, to: string): number {
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let n = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** The day an applicant arrived in the queue. */
function receivedOn(r: CandidateRow): string {
  return r.person_recruiting?.application_date ?? localISODate(new Date(r.created_at));
}

/**
 * The team rule is to clear the queue every business day: anything still
 * waiting after the next business day is overdue.
 */
function QueueHealth({ rows }: { rows: CandidateRow[] }) {
  const today = localISODate(new Date());
  const ages = rows.map((r) => businessDaysBetween(receivedOn(r), today));
  const overdue = ages.filter((a) => a >= 2).length;
  const oldest = Math.max(0, ...ages);
  const noJob = rows.filter((r) => !r.person_recruiting?.target_position_id).length;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${
        overdue > 0
          ? "border-rose-200 bg-rose-50/70 text-rose-800"
          : "border-emerald-200 bg-emerald-50/60 text-emerald-800"
      }`}
    >
      <span className="font-semibold">
        {rows.length} to review
      </span>
      {overdue > 0 ? (
        <span>
          ⏰ {overdue} waiting more than a business day · oldest {oldest} business day
          {oldest === 1 ? "" : "s"}
        </span>
      ) : (
        <span>On track — clear the queue every business day.</span>
      )}
      {noJob > 0 && (
        <span className="text-amber-800">
          💼 {noJob} with no job — pick one before accepting
        </span>
      )}
    </div>
  );
}

/**
 * Intake review queue: auto-ingested applicants (Gmail / Indeed) awaiting a
 * recruiter's accept or reject decision. Applications that clearly match one
 * open job arrive already assigned; the rest get a job picked here. Accepting
 * links the job, promotes them to an active lead and announces them in Slack;
 * rejecting marks them Declined (kept for re-apply detection).
 */
export function IntakeReview({
  rows,
  positions,
  canEdit,
  screeningForms,
  interviewers,
  currentUserId,
}: {
  rows: CandidateRow[];
  positions: PositionRow[];
  canEdit: boolean;
  screeningForms: ScreeningFormOption[];
  interviewers: InterviewerOption[];
  currentUserId: string | null;
}) {
  const [approved, setApproved] = useState<{ id: string; name: string; jobTitle: string | null } | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = rows.filter((r) => !done.has(r.id));

  function act(
    id: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onSuccess?: () => void,
  ) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setDone((prev) => new Set(prev).add(id));
        onSuccess?.();
        router.refresh();
      } else {
        setError(res.error);
      }
      setBusyId(null);
    });
  }

  const nextStep = approved && (
    <ApprovedNextStepDialog
      personId={approved.id}
      candidateName={approved.name}
      jobTitle={approved.jobTitle}
      forms={screeningForms}
      interviewers={interviewers}
      currentUserId={currentUserId}
      onClose={() => setApproved(null)}
    />
  );

  if (visible.length === 0) {
    return (
      <>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <div className="text-3xl">✅</div>
          <p className="mt-2 text-sm font-medium text-slate-700">Review queue is clear</p>
          <p className="mt-1 text-xs text-slate-500">
            New applications from the Ops application, the website form and Indeed appear here for a quick accept or reject.
          </p>
        </div>
        {nextStep}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {nextStep}
      <QueueHealth rows={visible} />
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {visible.map((r) => (
        <ReviewCard
          key={r.id}
          row={r}
          positions={positions}
          canEdit={canEdit}
          busy={busyId === r.id && isPending}
          onAccept={(jobId) =>
            act(
              r.id,
              () =>
                jobId === (r.person_recruiting?.target_position_id ?? null)
                  ? acceptCandidate(r.id)
                  : acceptCandidate(r.id, jobId),
              () =>
                setApproved({
                  id: r.id,
                  name: candidateName(r),
                  jobTitle:
                    positions.find((p) => p.id === jobId)?.title ?? r.person_recruiting?.target_title ?? null,
                }),
            )
          }
          onDecline={() => act(r.id, () => declineCandidate(r.id))}
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
  positions,
  canEdit,
  busy,
  onAccept,
  onDecline,
}: {
  row: CandidateRow;
  positions: PositionRow[];
  canEdit: boolean;
  busy: boolean;
  onAccept: (jobId: string | null) => void;
  onDecline: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string>(r.person_recruiting?.target_position_id ?? "");
  const linked = positions.find((p) => p.id === r.person_recruiting?.target_position_id);
  const openJobs = positions.filter((p) => p.status === "open");
  const [docs, setDocs] = useState<CandidateDocument[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const rec = r.person_recruiting;
  const source = rec?.source ?? "—";
  const applied = fmtDate(rec?.application_date) ?? fmtDate(r.created_at);
  const isReapply = (rec?.notes ?? "").includes("Re-applied");
  const noContact = !r.email && !r.phone_mobile;
  const phones = [r.phone_mobile, r.phone_home, r.phone_other].filter(Boolean) as string[];
  const screening = rec?.screening_answers ?? [];

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

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
            <span className="text-slate-500">
              Applied for{" "}
              <span className="font-medium text-slate-700">
                {[rec?.target_title, rec?.job_location].filter(Boolean).join(" @ ") ||
                  "role not specified"}
              </span>
            </span>
            {applied && <span className="text-slate-400">· {applied}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job</span>
            {canEdit ? (
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                disabled={busy}
                className={`max-w-xs rounded-lg border px-2 py-1 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                  jobId ? "border-slate-300 text-slate-800" : "border-amber-300 bg-amber-50 text-amber-800"
                }`}
              >
                <option value="">— No job —</option>
                {linked && linked.status === "closed" && (
                  <option value={linked.id} disabled>
                    {positionLabel(linked)} (closed)
                  </option>
                )}
                {openJobs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {positionLabel(p)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-slate-700">
                {linked ? positionLabel(linked) : "No job"}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            {r.email && <span>✉️ {r.email}</span>}
            {r.phone_mobile && <span>📞 {r.phone_mobile}</span>}
            {rec?.candidate_location && <span>📍 {rec.candidate_location}</span>}
            {rec?.relevant_experience && <span>💼 {rec.relevant_experience}</span>}
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
            onClick={() => onAccept(jobId || null)}
            disabled={busy}
            title="Link the job, accept into the pipeline and announce in the Slack hiring channel"
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
              {rec?.candidate_location && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">City</dt>
                  <dd>{rec.candidate_location}</dd>
                </div>
              )}
              {rec?.relevant_experience && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">Experience</dt>
                  <dd>{rec.relevant_experience}</dd>
                </div>
              )}
              {rec?.education && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">Education</dt>
                  <dd>{rec.education}</dd>
                </div>
              )}
              {rec?.job_location && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-400">Applied to</dt>
                  <dd>{rec.job_location}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Screening questions answered on the job posting */}
          {screening.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Screening questions
              </h4>
              <dl className="mt-1.5 max-w-3xl space-y-1.5 text-sm">
                {screening.map((a, i) => (
                  <div key={i} className="flex flex-wrap gap-x-2">
                    <dt className="text-slate-400">{a.question}</dt>
                    <dd className="font-medium text-slate-700">{a.answer ?? "—"}</dd>
                    {a.match === "No" && (
                      <span className="rounded-full bg-rose-100 px-2 text-xs font-semibold text-rose-700">
                        Does not meet
                      </span>
                    )}
                  </div>
                ))}
              </dl>
            </div>
          )}

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
