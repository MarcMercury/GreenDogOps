"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { partnerLeadUrl } from "@/lib/crm/types";
import type { MarketingEvent, MarketingPromotion } from "@/lib/marketing/types";
import {
  type QrCode,
  type QrForm,
  type QrFormField,
  type QrLead,
  QR_CODE_TYPES,
  QR_FIELD_TYPES,
  qrCodeTypeLabel,
  qrScanUrl,
  slugifyFieldKey,
} from "@/lib/marketing/qr";
import {
  saveQrCode,
  deleteQrCode,
  setQrCodeActive,
  saveQrForm,
  deleteQrForm,
} from "../qr-actions";
import { PageHeader } from "../../_components/ui";

const fieldInput =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const fieldLabel = "mb-1 block text-xs font-medium text-slate-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50";

export type PartnerCodeRow = {
  id: string;
  name: string;
  token: string;
  leads: number;
};

/** A CE course a code can be attached to (built in the CE module). */
export type CeEventRef = {
  id: string;
  name: string;
  event_date: string | null;
};

type Run = (
  action: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  after?: () => void,
) => void;

type TabKey = "codes" | "forms" | "partners";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "codes", label: "QR Codes", icon: "🔳" },
  { key: "forms", label: "Forms", icon: "📝" },
  { key: "partners", label: "Retail Partner Codes", icon: "🤝" },
];

function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // Browser-only value, read after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  return origin;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function QrCodesWorkspace({
  canEdit,
  codes,
  forms,
  leads,
  events,
  promotions,
  ceEvents,
  partnerCodes,
}: {
  canEdit: boolean;
  codes: QrCode[];
  forms: QrForm[];
  leads: Pick<QrLead, "id" | "qr_code_id" | "scanned_at">[];
  events: Pick<MarketingEvent, "id" | "name" | "starts_on">[];
  promotions: Pick<MarketingPromotion, "id" | "name">[];
  ceEvents: CeEventRef[];
  partnerCodes: PartnerCodeRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("codes");
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editingCode, setEditingCode] = useState<QrCode | "new" | null>(null);
  const [editingForm, setEditingForm] = useState<QrForm | "new" | null>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }
  const run: Run = (action, after) => {
    startTransition(async () => {
      const res = await action();
      notify(res.ok ? res.message ?? "Saved." : `Error: ${res.error}`);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  const leadCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.qr_code_id, (m.get(l.qr_code_id) ?? 0) + 1);
    return m;
  }, [leads]);

  const formById = useMemo(() => {
    const m = new Map<string, QrForm>();
    for (const f of forms) m.set(f.id, f);
    return m;
  }, [forms]);

  const formUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of codes) if (c.form_id) m.set(c.form_id, (m.get(c.form_id) ?? 0) + 1);
    return m;
  }, [codes]);

  const activeCount = codes.filter((c) => c.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="QR Code Management"
        description="Every code we've printed — events, promotions and retail partners — plus the forms behind them."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active codes" value={activeCount} />
        <Stat label="Total scans" value={codes.reduce((s, c) => s + c.scan_count, 0)} />
        <Stat label="Leads captured" value={leads.length} />
        <Stat label="Forms" value={forms.length} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="mr-1.5" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "codes" && (
        <CodesTab
          codes={codes}
          formById={formById}
          leadCounts={leadCounts}
          events={events}
          ceEvents={ceEvents}
          canEdit={canEdit}
          onEdit={setEditingCode}
          run={run}
        />
      )}
      {tab === "forms" && (
        <FormsTab forms={forms} usage={formUsage} canEdit={canEdit} onEdit={setEditingForm} />
      )}
      {tab === "partners" && <PartnersTab rows={partnerCodes} />}

      {editingCode && (
        <CodeDialog
          code={editingCode === "new" ? null : editingCode}
          forms={forms}
          events={events}
          promotions={promotions}
          ceEvents={ceEvents}
          canEdit={canEdit}
          onClose={() => setEditingCode(null)}
          run={run}
        />
      )}
      {editingForm && (
        <FormDialog
          form={editingForm === "new" ? null : editingForm}
          canEdit={canEdit}
          onClose={() => setEditingForm(null)}
          run={run}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-slate-900">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CodesTab({
  codes,
  formById,
  leadCounts,
  events,
  ceEvents,
  canEdit,
  onEdit,
  run,
}: {
  codes: QrCode[];
  formById: Map<string, QrForm>;
  leadCounts: Map<string, number>;
  events: Pick<MarketingEvent, "id" | "name" | "starts_on">[];
  ceEvents: CeEventRef[];
  canEdit: boolean;
  onEdit: (c: QrCode | "new") => void;
  run: Run;
}) {
  const origin = useOrigin();
  const [type, setType] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");

  const subjectById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) m.set(e.id, e.name);
    for (const e of ceEvents) m.set(e.id, `CE: ${e.name}`);
    return m;
  }, [events, ceEvents]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return codes.filter((c) => {
      if (type && c.code_type !== type) return false;
      if (!showInactive && !c.active) return false;
      if (!needle) return true;
      const subject = c.event_id ?? c.ce_event_id;
      return [c.label, c.notes, subject ? subjectById.get(subject) : null]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [codes, type, showInactive, q, subjectById]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search codes…"
          className={`${fieldInput} max-w-xs`}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="">All types</option>
          {QR_CODE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Show inactive
        </label>
        <span className="text-sm text-slate-400">{filtered.length} shown</span>
        {canEdit && (
          <button type="button" onClick={() => onEdit("new")} className={`${btnPrimary} ml-auto`}>
            + QR code
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
          No QR codes yet.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((c) => (
            <CodeCard
              key={c.id}
              code={c}
              origin={origin}
              form={c.form_id ? formById.get(c.form_id) ?? null : null}
              subjectName={subjectById.get(c.event_id ?? c.ce_event_id ?? "") ?? null}
              leads={leadCounts.get(c.id) ?? 0}
              canEdit={canEdit}
              onEdit={onEdit}
              run={run}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CodeCard({
  code,
  origin,
  form,
  subjectName,
  leads,
  canEdit,
  onEdit,
  run,
}: {
  code: QrCode;
  origin: string;
  form: QrForm | null;
  subjectName: string | null;
  leads: number;
  canEdit: boolean;
  onEdit: (c: QrCode) => void;
  run: Run;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const url = origin ? qrScanUrl(origin, code.token) : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the link:", url);
    }
  }

  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const slug = code.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "qr";
    const link = document.createElement("a");
    link.download = `${slug}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${code.active ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
      <div className="flex gap-4">
        <div ref={qrRef} className="shrink-0 rounded-lg border border-slate-200 p-1.5">
          {url ? <QRCodeCanvas value={url} size={96} marginSize={1} level="M" /> : <div className="h-24 w-24" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-slate-900">{code.label}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {qrCodeTypeLabel(code.code_type)}
            </span>
            {!code.active && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                Inactive
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {subjectName ? subjectName : code.target_url ? `→ ${code.target_url}` : form ? `Form: ${form.name}` : "No form attached"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {code.scan_count} scans · {leads} leads · last {fmtDate(code.last_scanned_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={copy} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              {copied ? "✓ Copied" : "Copy link"}
            </button>
            <button type="button" onClick={download} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Download
            </button>
            {canEdit && (
              <>
                <button type="button" onClick={() => onEdit(code)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => run(() => setQrCodeActive(code.id, !code.active))}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {code.active ? "Deactivate" : "Activate"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function FormsTab({
  forms,
  usage,
  canEdit,
  onEdit,
}: {
  forms: QrForm[];
  usage: Map<string, number>;
  canEdit: boolean;
  onEdit: (f: QrForm | "new") => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          A form can be reused by any number of codes. Answers land on the lead record.
        </p>
        {canEdit && (
          <button type="button" onClick={() => onEdit("new")} className={btnPrimary}>
            + Form
          </button>
        )}
      </div>
      {forms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
          No forms yet.
        </p>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Form</th>
                <th className="px-4 py-2.5 font-semibold">Questions</th>
                <th className="px-4 py-2.5 font-semibold">Used by</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forms.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer transition hover:bg-slate-50"
                  onClick={() => canEdit && onEdit(f)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{f.name}</div>
                    {f.headline && <div className="text-xs text-slate-400">{f.headline}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{f.fields?.length ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600">{usage.get(f.id) ?? 0} codes</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        f.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {f.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function PartnersTab({ rows }: { rows: PartnerCodeRow[] }) {
  const origin = useOrigin();
  const [q, setQ] = useState("");
  const [onlyUsed, setOnlyUsed] = useState(true);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) => (!onlyUsed || r.leads > 0) && (!needle || r.name.toLowerCase().includes(needle)),
    );
  }, [rows, q, onlyUsed]);

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-500">
        Every Non-Med Partner has a permanent code pointing at their retail lead form.
        These are managed on the partner&apos;s CRM record.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search partners…"
          className={`${fieldInput} max-w-xs`}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyUsed}
            onChange={(e) => setOnlyUsed(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Only partners with leads
        </label>
        <span className="text-sm text-slate-400">{filtered.length} of {rows.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-400">
          No partner codes match.
        </p>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Partner</th>
                <th className="px-4 py-2.5 font-semibold">Scan link</th>
                <th className="px-4 py-2.5 text-right font-semibold">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/crm/org/${r.id}`} className="font-medium text-emerald-700 hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                    {origin ? partnerLeadUrl(origin, r.token) : `/lead/${r.token}`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.leads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function CodeDialog({
  code,
  forms,
  events,
  promotions,
  ceEvents,
  canEdit,
  onClose,
  run,
}: {
  code: QrCode | null;
  forms: QrForm[];
  events: Pick<MarketingEvent, "id" | "name" | "starts_on">[];
  promotions: Pick<MarketingPromotion, "id" | "name">[];
  ceEvents: CeEventRef[];
  canEdit: boolean;
  onClose: () => void;
  run: Run;
}) {
  const [codeType, setCodeType] = useState(code?.code_type ?? "event");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(() => saveQrCode(new FormData(e.currentTarget)), onClose);
  }

  return (
    <Modal title={code ? "Edit QR code" : "New QR code"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {code && <input type="hidden" name="id" value={code.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Label</label>
            <input name="label" defaultValue={code?.label ?? ""} required className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Type</label>
            <select
              name="code_type"
              value={codeType}
              onChange={(e) => setCodeType(e.target.value)}
              className={fieldInput}
            >
              {QR_CODE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {codeType === "event" && (
            <div className="sm:col-span-2">
              <label className={fieldLabel}>Event</label>
              <select name="event_id" defaultValue={code?.event_id ?? ""} className={fieldInput}>
                <option value="">—</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.starts_on ? ` (${e.starts_on})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {codeType === "ce" && (
            <div className="sm:col-span-2">
              <label className={fieldLabel}>CE course</label>
              <select name="ce_event_id" defaultValue={code?.ce_event_id ?? ""} className={fieldInput}>
                <option value="">—</option>
                {ceEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.event_date ? ` (${e.event_date})` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                The course itself is built in the CE module — this only attaches a code.
              </p>
            </div>
          )}
          {codeType === "promo" && (
            <div className="sm:col-span-2">
              <label className={fieldLabel}>Promotion</label>
              <select name="promotion_id" defaultValue={code?.promotion_id ?? ""} className={fieldInput}>
                <option value="">—</option>
                {promotions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Capture form</label>
            <select name="form_id" defaultValue={code?.form_id ?? ""} className={fieldInput}>
              <option value="">— none (use a link instead)</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Or redirect to a URL</label>
            <input
              name="target_url"
              defaultValue={code?.target_url ?? ""}
              placeholder="https://… (takes priority over the form)"
              className={fieldInput}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Notes</label>
            <textarea name="notes" defaultValue={code?.notes ?? ""} rows={2} className={fieldInput} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="active"
            defaultChecked={code?.active ?? true}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
          />
          Active — scans are accepted
        </label>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            {code && canEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${code.label}"? Printed copies stop working.`)) {
                    run(() => deleteQrCode(code.id), onClose);
                  }
                }}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Delete code
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={!canEdit} className={btnPrimary}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function FormDialog({
  form,
  canEdit,
  onClose,
  run,
}: {
  form: QrForm | null;
  canEdit: boolean;
  onClose: () => void;
  run: Run;
}) {
  const [fields, setFields] = useState<QrFormField[]>(form?.fields ?? []);

  function patchField(idx: number, p: Partial<QrFormField>) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...p } : f)));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set(
      "fields_json",
      JSON.stringify(
        fields
          .filter((f) => f.label.trim())
          .map((f) => ({ ...f, key: f.key || slugifyFieldKey(f.label) })),
      ),
    );
    run(() => saveQrForm(fd), onClose);
  }

  return (
    <Modal title={form ? "Edit form" : "New form"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {form && <input type="hidden" name="id" value={form.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>Form name (internal)</label>
            <input name="name" defaultValue={form?.name ?? ""} required className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>Headline</label>
            <input name="headline" defaultValue={form?.headline ?? ""} className={fieldInput} />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Intro text</label>
            <textarea name="intro" defaultValue={form?.intro ?? ""} rows={2} className={fieldInput} />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabel}>Thank-you message</label>
            <input name="success_message" defaultValue={form?.success_message ?? ""} className={fieldInput} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="collect_pet_name"
              defaultChecked={form?.collect_pet_name ?? true}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            Ask for pet name
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="collect_zip"
              defaultChecked={form?.collect_zip ?? false}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            Ask for ZIP code
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="active"
              defaultChecked={form?.active ?? true}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            Active
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom questions</p>
          <ul className="space-y-2">
            {fields.map((f, idx) => (
              <li key={idx} className="rounded-lg border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={f.label}
                    onChange={(e) => patchField(idx, { label: e.target.value })}
                    placeholder="Question…"
                    className="min-w-[10rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => patchField(idx, { type: e.target.value as QrFormField["type"] })}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    {QR_FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => patchField(idx, { required: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
                    className="px-1 text-slate-300 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                {f.type === "select" && (
                  <input
                    value={f.options.join(", ")}
                    onChange={(e) =>
                      patchField(idx, {
                        options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    placeholder="Options, comma separated"
                    className="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none"
                  />
                )}
              </li>
            ))}
            {fields.length === 0 && (
              <li className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400">
                No extra questions — the form just collects contact details.
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={() =>
              setFields((prev) => [
                ...prev,
                { key: "", label: "", type: "text", required: false, options: [], placeholder: null },
              ])
            }
            className={`${btnGhost} mt-2`}
          >
            ＋ Add question
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            {form && canEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete the form "${form.name}"? Codes using it will stop working.`)) {
                    run(() => deleteQrForm(form.id), onClose);
                  }
                }}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Delete form
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={!canEdit} className={btnPrimary}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
