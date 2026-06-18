"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_ICONS,
  categoryLabel,
  CREDENTIAL_CATEGORIES,
  type Credential,
} from "@/lib/admin/credentials";
import { saveCredential, deleteCredential } from "../actions";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      title="Copy"
    >
      {done ? "✓" : "copy"}
    </button>
  );
}

function Secret({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-slate-800">
        {show ? value : "•".repeat(Math.min(value.length, 10))}
      </span>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        {show ? "hide" : "show"}
      </button>
      <CopyButton value={value} />
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 break-words text-slate-700">{children}</span>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  full,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  full?: boolean;
}) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </span>
      <input name={name} defaultValue={defaultValue ?? ""} className={inputCls} />
    </label>
  );
}

function CredentialForm({
  cred,
  onClose,
}: {
  cred: Credential | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            {cred ? "Edit credential" : "Add credential"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <form action={saveCredential} className="space-y-4 p-5">
          {cred ? <input type="hidden" name="id" value={cred.id} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label *" name="label" defaultValue={cred?.label} full />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Category
              </span>
              <select
                name="category"
                defaultValue={cred?.category ?? "vendor"}
                className={`${inputCls} bg-white`}
              >
                {CREDENTIAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Service" name="service" defaultValue={cred?.service} />
            <Field label="URL" name="url" defaultValue={cred?.url} full />
            <Field label="Username" name="username" defaultValue={cred?.username} />
            <Field label="Password" name="password" defaultValue={cred?.password} />
            <Field
              label="Account #"
              name="account_number"
              defaultValue={cred?.account_number}
            />
            <Field label="Location" name="location" defaultValue={cred?.location} />
            <Field
              label="Contact name"
              name="contact_name"
              defaultValue={cred?.contact_name}
            />
            <Field
              label="Contact email"
              name="contact_email"
              defaultValue={cred?.contact_email}
            />
            <Field
              label="Contact phone"
              name="contact_phone"
              defaultValue={cred?.contact_phone}
            />
            <Field label="Status" name="status" defaultValue={cred?.status} />
            <Field
              label="Order method"
              name="order_method"
              defaultValue={cred?.order_method}
            />
            <Field
              label="Payment method"
              name="payment_method"
              defaultValue={cred?.payment_method}
            />
            <Field
              label="Owner / scope"
              name="owner_scope"
              defaultValue={cred?.owner_scope}
              full
            />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Notes
              </span>
              <textarea
                name="notes"
                defaultValue={cred?.notes ?? ""}
                rows={3}
                className={inputCls}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={() => setTimeout(onClose, 0)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {cred ? "Save changes" : "Add credential"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CredentialRow({
  c,
  onEdit,
}: {
  c: Credential;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const statusColor = c.status
    ? /not|incorrect|fail/i.test(c.status)
      ? "text-rose-600"
      : /work|active/i.test(c.status)
        ? "text-emerald-600"
        : "text-slate-500"
    : "text-slate-400";
  return (
    <div className="bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={`shrink-0 text-slate-400 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          <span className="shrink-0 text-base">
            {CATEGORY_ICONS[c.category] ?? "🔑"}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900">
              {c.label}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <span>{categoryLabel(c.category)}</span>
              {c.location ? <span>· {c.location}</span> : null}
              {c.status ? (
                <span className={`font-medium ${statusColor}`}>
                  · {c.status}
                </span>
              ) : null}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Edit
          </button>
          <form
            action={deleteCredential}
            onSubmit={(e) => {
              if (!confirm(`Delete credential “${c.label}”?`))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={c.id} />
            <button
              type="submit"
              className="rounded px-2 py-1 text-xs font-medium text-rose-500 hover:bg-rose-50"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      {open ? (
      <div className="space-y-1.5 px-4 pb-4 pl-14">
        {c.url ? (
          <Row label="URL">
            <a
              href={c.url.startsWith("http") ? c.url : `https://${c.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 hover:underline"
            >
              {c.url}
            </a>
          </Row>
        ) : null}
        {c.username ? (
          <Row label="Username">
            <span className="font-mono text-xs">{c.username}</span>
            <span className="ml-1.5 align-middle">
              <CopyButton value={c.username} />
            </span>
          </Row>
        ) : null}
        {c.password ? (
          <Row label="Password">
            <Secret value={c.password} />
          </Row>
        ) : null}
        {c.account_number ? (
          <Row label="Account #">{c.account_number}</Row>
        ) : null}
        {c.contact_name || c.contact_phone || c.contact_email ? (
          <Row label="Contact">
            {[c.contact_name, c.contact_phone, c.contact_email]
              .filter(Boolean)
              .join(" · ")}
          </Row>
        ) : null}
        {c.order_method || c.payment_method ? (
          <Row label="Order/Pay">
            {[c.order_method, c.payment_method].filter(Boolean).join(" · ")}
          </Row>
        ) : null}
        {c.owner_scope ? <Row label="Scope">{c.owner_scope}</Row> : null}
        {c.notes ? <Row label="Notes">{c.notes}</Row> : null}
      </div>
      ) : null}
    </div>
  );
}

export function CredentialsView({
  credentials,
}: {
  credentials: Credential[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editing, setEditing] = useState<Credential | null>(null);
  const [adding, setAdding] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of credentials)
      counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [credentials]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return credentials.filter((c) => {
      if (category !== "all" && c.category !== category) return false;
      if (!q) return true;
      return [
        c.label,
        c.service,
        c.username,
        c.account_number,
        c.location,
        c.contact_name,
        c.contact_email,
        c.url,
        c.notes,
        c.owner_scope,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [credentials, query, category]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendor, username, account #, notes…"
          className={`${inputCls} w-full sm:w-80`}
        />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          + Add credential
        </button>
      </div>

      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:flex-wrap">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            category === "all"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          All ({credentials.length})
        </button>
        {categories.map(([cat, n]) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              category === cat
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {CATEGORY_ICONS[cat] ?? "🔑"} {categoryLabel(cat)} ({n})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          No credentials match your search.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
          {filtered.map((c) => (
            <CredentialRow key={c.id} c={c} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}

      {(editing || adding) && (
        <CredentialForm
          cred={editing}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
