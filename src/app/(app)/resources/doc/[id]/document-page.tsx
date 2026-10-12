"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clinicToday, type SignatureState } from "@/lib/resources/access";
import type { DocNode } from "@/lib/resources/content";
import type { SignatureRow, SignerStatus } from "@/lib/resources/server";
import type { ResourceKind } from "@/lib/resources/types";
import {
  replaceDocumentFile,
  sendDocument,
  signDocument,
  stopSignatureRequirement,
  updateDocumentAccess,
  type DocActionResult,
} from "../actions";
import { DocumentViewer } from "../_components/document-viewer";
import { NOTICE_KEY, SaveDialog } from "../_components/document-editor";
import { AccessPicker, type AccessValue } from "../_components/access-picker";

export interface VersionInfo {
  version_no: number;
  title: string;
  change_note: string | null;
  created_at: string;
  author: string | null;
  notified_count: number;
  signature_required: boolean;
  file_name: string | null;
}

interface DocInfo {
  id: string;
  title: string;
  description: string | null;
  kind: ResourceKind;
  isActive: boolean;
  categoryLabel: string;
  currentVersion: number;
  shownVersion: number;
  showingOld: boolean;
  updatedAt: string;
  requireSignature: boolean;
  signatureFromVersion: number | null;
  sourceUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  visibleRoles: string[] | null;
  viewerIds: string[];
}

interface ManagerData {
  versions: VersionInfo[];
  statuses: SignerStatus[];
  others: SignatureRow[];
  history: SignatureRow[];
  people: { id: string; name: string; role: string }[];
  audienceCount: number;
  accessSummary: string;
}

/** "2026-10-12" → "Oct 12, 2026" without a time-zone shift. */
function formatDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export function DocumentPage({
  doc,
  content,
  mySignature,
  manager,
}: {
  doc: DocInfo;
  content: DocNode | null;
  mySignature: { state: SignatureState; latest: { version_no: number; initials: string; signed_on: string } | null };
  manager: ManagerData | null;
}) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(NOTICE_KEY);
    if (saved) {
      sessionStorage.removeItem(NOTICE_KEY);
      // Shown once after the editor redirects here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice({ ok: true, text: saved });
    }
  }, []);

  const report = (res: DocActionResult) =>
    setNotice(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });

  const isPdf = !!doc.fileName && /\.pdf$/i.test(doc.fileName);
  const needsMySignature = mySignature.state === "pending" && !doc.showingOld && doc.isActive;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/resources" className="text-sm font-medium text-emerald-700 hover:underline">
          ← All resources
        </Link>
        {manager && doc.kind === "native" && !doc.showingOld ? (
          <Link
            href={`/resources/doc/${doc.id}/edit`}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            ✏️ Edit
          </Link>
        ) : null}
      </div>

      {notice ? (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-lg px-4 py-2.5 text-sm ${
            notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      ) : null}

      {doc.showingOld ? (
        <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You are viewing version {doc.shownVersion}, not the current one.{" "}
          <Link href={`/resources/doc/${doc.id}`} className="font-semibold underline">
            View version {doc.currentVersion}
          </Link>
        </div>
      ) : null}

      {!doc.isActive ? (
        <div className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-700">
          This document is archived and hidden from the library.
        </div>
      ) : null}

      {needsMySignature ? (
        <a
          href="#sign"
          className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm hover:bg-amber-100"
        >
          <span className="font-semibold">✍️ Your signature is needed.</span> Please read this document, then add your
          initials at the bottom to confirm you have received and reviewed it.
        </a>
      ) : null}

      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-5 py-4 sm:px-8">
          <p className="text-xs font-medium text-slate-500">{doc.categoryLabel}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{doc.title}</h2>
          {doc.description ? <p className="mt-1 text-sm text-slate-500">{doc.description}</p> : null}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {doc.shownVersion > 0 ? <span>Version {doc.shownVersion}</span> : null}
            <span>Updated {formatStamp(doc.updatedAt)}</span>
            {doc.requireSignature ? (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700">Signature required</span>
            ) : null}
            {manager ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {doc.visibleRoles === null ? "👥" : "🔒"} {manager.accessSummary}
              </span>
            ) : null}
          </p>
        </header>

        <div className="px-5 py-6 sm:px-8">
          {doc.kind === "native" && content ? <DocumentViewer content={content} /> : null}

          {doc.kind === "file" ? (
            doc.fileUrl ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {isPdf ? "Open PDF in a new tab ↗" : `Download ${doc.fileName ?? "file"} ↓`}
                  </a>
                </div>
                {isPdf ? (
                  <iframe
                    src={doc.fileUrl}
                    title={doc.title}
                    className="h-[80vh] w-full rounded-lg border border-slate-200"
                  />
                ) : (
                  <p className="text-sm text-slate-500">Word documents open in your browser or Word after downloading.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-red-600">The file could not be loaded. Try again in a moment.</p>
            )
          ) : null}

          {doc.kind === "link" && doc.sourceUrl ? (
            <a
              href={doc.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-slate-50"
            >
              Open link ↗
            </a>
          ) : null}
        </div>

        {doc.requireSignature && mySignature.state !== "not_required" && !doc.showingOld && doc.isActive ? (
          <SignPanel doc={doc} mySignature={mySignature} onResult={report} />
        ) : null}
      </article>

      {manager ? <ManagerPanels doc={doc} data={manager} onResult={report} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initial + date
// ---------------------------------------------------------------------------

function SignPanel({
  doc,
  mySignature,
  onResult,
}: {
  doc: DocInfo;
  mySignature: { state: SignatureState; latest: { version_no: number; initials: string; signed_on: string } | null };
  onResult: (r: DocActionResult) => void;
}) {
  const router = useRouter();
  const [initials, setInitials] = useState("");
  const [agree, setAgree] = useState(false);
  const [pending, startTransition] = useTransition();
  const today = clinicToday();

  if (mySignature.state === "signed" && mySignature.latest) {
    return (
      <div id="sign" className="border-t border-emerald-100 bg-emerald-50/60 px-5 py-4 text-sm text-emerald-800 sm:px-8">
        ✅ You signed version {mySignature.latest.version_no} on {formatDay(mySignature.latest.signed_on)} (initials{" "}
        <span className="font-semibold">{mySignature.latest.initials}</span>).
      </div>
    );
  }

  return (
    <form
      id="sign"
      className="space-y-3 border-t border-amber-200 bg-amber-50/60 px-5 py-5 sm:px-8"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await signDocument({ id: doc.id, version: doc.currentVersion, initials });
          onResult(res);
          if (res.ok) router.refresh();
        });
      }}
    >
      <p className="text-sm font-semibold text-slate-800">Acknowledge receipt</p>
      {mySignature.latest ? (
        <p className="text-xs text-slate-500">
          You signed version {mySignature.latest.version_no} earlier; this version needs a new signature.
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        I have received, read and understand “{doc.title}” (version {doc.currentVersion}).
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Initials</span>
          <input
            value={initials}
            onChange={(e) => setInitials(e.target.value.toUpperCase())}
            maxLength={10}
            required
            autoComplete="off"
            placeholder="e.g. JD"
            className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold uppercase tracking-wide shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Date</span>
          <input
            value={formatDay(today)}
            readOnly
            aria-readonly
            className="w-36 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !agree || !initials.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Signing…" : "Sign"}
        </button>
      </div>
      <p className="text-xs text-slate-500">Your initials, the date and time are saved to your HR profile.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// HR / Manager panels
// ---------------------------------------------------------------------------

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ManagerPanels({
  doc,
  data,
  onResult,
}: {
  doc: DocInfo;
  data: ManagerData;
  onResult: (r: DocActionResult) => void;
}) {
  const router = useRouter();
  const [sendOpen, setSendOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const canVersion = doc.kind !== "link";

  const run = (fn: () => Promise<DocActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      onResult(res);
      if (res.ok) router.refresh();
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Send & signatures">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Addressed to {data.audienceCount === 1 ? "1 person" : `${data.audienceCount} people`} (see “Who can view”).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !doc.isActive}
              onClick={() => setSendOpen(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              📣 Send to access group…
            </button>
            {doc.requireSignature ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Stop requiring signatures on this document? Existing signatures are kept.")) {
                    run(() => stopSignatureRequirement(doc.id));
                  }
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Stop requiring signatures
              </button>
            ) : null}
          </div>
          {doc.requireSignature && doc.signatureFromVersion ? (
            <p className="text-xs text-slate-500">
              Signatures on version {doc.signatureFromVersion} or later count as current.
            </p>
          ) : null}
        </div>
        {doc.kind === "file" ? <ReplaceFileForm docId={doc.id} audienceCount={data.audienceCount} onResult={onResult} /> : null}
      </Panel>

      <AccessPanel doc={doc} data={data} onResult={onResult} />

      <SignaturesPanel doc={doc} data={data} />

      {canVersion ? <VersionsPanel doc={doc} versions={data.versions} /> : null}

      {sendOpen ? (
        <SaveDialog
          isNew={false}
          sendOnly
          title={`Send “${doc.title}”`}
          submitLabel="Send"
          audienceCount={data.audienceCount}
          alreadyRequiresSignature={doc.requireSignature}
          pending={pending}
          onCancel={() => setSendOpen(false)}
          onSave={({ changeNote, requireSignature }) => {
            setSendOpen(false);
            run(() => sendDocument({ id: doc.id, requireSignature: canVersion && requireSignature, note: changeNote }));
          }}
        >
          <p className="text-sm text-slate-600">
            Sends an Ops notification about the current version to the people this document is addressed to.
            {canVersion ? "" : " Links to other sites cannot collect signatures."}
          </p>
        </SaveDialog>
      ) : null}
    </div>
  );
}

function ReplaceFileForm({
  docId,
  audienceCount,
  onResult,
}: {
  docId: string;
  audienceCount: number;
  onResult: (r: DocActionResult) => void;
}) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState<DocActionResult | null, FormData>(replaceDocumentFile, null);
  const [requireSignature, setRequireSignature] = useState(false);
  const handled = useRef<DocActionResult | null>(null);

  useEffect(() => {
    if (!result || handled.current === result) return;
    handled.current = result;
    onResult(result);
    if (result.ok) router.refresh();
  }, [result, onResult, router]);

  return (
    <form action={formAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
      <input type="hidden" name="id" value={docId} />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upload a new version</p>
      <input
        name="file"
        type="file"
        required
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700"
      />
      <input
        name="change_note"
        maxLength={500}
        placeholder="What changed? (optional)"
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm"
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input name="notify" type="checkbox" className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
        Notify access group ({audienceCount}){requireSignature ? " — always sent when signatures are required" : ""}
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          name="require_signature"
          type="checkbox"
          onChange={(e) => setRequireSignature(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        Require signature on the new version
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload new version"}
      </button>
    </form>
  );
}

function AccessPanel({
  doc,
  data,
  onResult,
}: {
  doc: DocInfo;
  data: ManagerData;
  onResult: (r: DocActionResult) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const initial = (): AccessValue => ({
    everyone: doc.visibleRoles === null,
    roles: new Set(doc.visibleRoles ?? []),
    viewers: new Set(doc.viewerIds),
  });
  const [value, setValue] = useState<AccessValue>(initial);
  const [pending, startTransition] = useTransition();
  const named = data.people.filter((p) => doc.viewerIds.includes(p.id));

  const save = () =>
    startTransition(async () => {
      const res = await updateDocumentAccess({
        id: doc.id,
        everyone: value.everyone,
        roles: [...value.roles],
        viewerIds: [...value.viewers],
      });
      onResult(res);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  return (
    <Panel
      title="Who can view"
      actions={
        !editing ? (
          <button
            type="button"
            onClick={() => {
              setValue(initial());
              setEditing(true);
            }}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Change
          </button>
        ) : null
      }
    >
      {!editing ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p className="font-medium text-slate-800">{data.accessSummary}</p>
          {named.length ? <p className="text-xs">People: {named.map((p) => p.name).join(", ")}</p> : null}
          <p className="text-xs text-slate-500">
            These people are notified and asked to sign. HR / Managers, Executives, Admins and Owners can always open
            and manage it.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AccessPicker value={value} people={data.people} onChange={setValue} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save access"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function SignaturesPanel({ doc, data }: { doc: DocInfo; data: ManagerData }) {
  if (!doc.requireSignature) {
    if (!data.history.length) return null;
    return (
      <Panel title="Signature history">
        <SignatureList rows={data.history} />
      </Panel>
    );
  }
  const signed = data.statuses.filter((s) => s.state === "signed").length;
  return (
    <Panel title={`Signatures — ${signed} of ${data.statuses.length} signed`}>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
        {data.statuses.map((s) => (
          <li key={s.user.id} className="flex items-center justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate text-slate-800">{s.user.full_name?.trim() || s.user.email}</span>
            {s.state === "signed" && s.signature ? (
              <span className="shrink-0 text-xs text-emerald-700">
                ✅ {s.signature.initials} · {formatDay(s.signature.signed_on)} · v{s.signature.version_no}
              </span>
            ) : (
              <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                Pending{s.signature ? ` (signed v${s.signature.version_no})` : ""}
              </span>
            )}
          </li>
        ))}
        {!data.statuses.length ? <li className="py-1.5 text-xs text-slate-400">Nobody else can view this document yet.</li> : null}
      </ul>
      {data.others.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Signed, no longer in the access group</p>
          <SignatureList rows={data.others} />
        </div>
      ) : null}
    </Panel>
  );
}

function SignatureList({ rows }: { rows: SignatureRow[] }) {
  return (
    <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
          <span className="truncate text-slate-700">{r.signer_name}</span>
          <span className="shrink-0 text-xs text-slate-500">
            {r.initials} · {formatDay(r.signed_on)} · v{r.version_no}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VersionsPanel({ doc, versions }: { doc: DocInfo; versions: VersionInfo[] }) {
  return (
    <Panel title="Version history">
      {versions.length ? (
        <ol className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
          {versions.map((v) => (
            <li key={v.version_no} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">
                  Version {v.version_no}
                  {v.version_no === doc.currentVersion ? <span className="ml-1.5 text-xs font-normal text-emerald-700">current</span> : null}
                  {v.signature_required ? <span className="ml-1.5 text-xs font-normal text-violet-700">signatures requested</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {formatStamp(v.created_at)}
                  {v.author ? ` · ${v.author}` : ""}
                  {v.notified_count ? ` · notified ${v.notified_count}` : ""}
                </p>
                {v.change_note ? <p className="mt-0.5 text-xs text-slate-600">{v.change_note}</p> : null}
              </div>
              {v.version_no !== doc.shownVersion ? (
                <Link href={`/resources/doc/${doc.id}?v=${v.version_no}`} className="shrink-0 text-xs font-semibold text-emerald-700 hover:underline">
                  View
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-500">No versions yet. Sending or replacing the document starts the history.</p>
      )}
    </Panel>
  );
}
