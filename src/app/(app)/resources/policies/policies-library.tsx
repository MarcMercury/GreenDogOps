"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  formatBytes,
  resourceCategoryMeta,
  type PolicyCategory,
  type ResourceCategory,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";
import {
  createResourceCategory,
  createResourceLink,
  deleteResourceCategory,
  deleteResourceDocument,
  updateResourceCategory,
  updateResourceDocument,
  uploadPolicyDocument,
  type UploadResult,
} from "./actions";

type CollectionItem = {
  id: string;
  title: string;
  href: string | null;
  description?: string | null;
  meta?: string | null;
  staffOnly?: boolean;
  // Management metadata (present only for resource_document-backed items).
  docId?: string;
  isLink?: boolean;
  category?: string;
  sourceUrl?: string | null;
};

type Collection = {
  key: string;
  label: string;
  icon: string;
  kind: "document" | "policy";
  accent: string;
  items: CollectionItem[];
  // DB-backed document categories can be renamed/deleted; policy links cannot.
  categoryKey?: string;
  managed?: boolean;
};

const KIND_META = {
  document: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    dot: "bg-emerald-500",
    hover: "hover:bg-emerald-50/50",
  },
  policy: {
    badge: "bg-blue-50 text-blue-700 ring-blue-100",
    dot: "bg-blue-500",
    hover: "hover:bg-blue-50/50",
  },
} as const;

export function PoliciesLibrary({
  documents,
  policies,
  categories,
  canUpload = false,
}: {
  documents: ResourceDocumentWithUrl[];
  policies: PolicyCategory[];
  categories: ResourceCategory[];
  canUpload?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<"all" | "document" | "policy">(
    "all",
  );
  const [editItem, setEditItem] = useState<CollectionItem | null>(null);
  const [manageCat, setManageCat] = useState<Collection | null>(null);
  // Sections start collapsed for a cleaner page; toggling removes the key.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    for (const d of documents) keys.add(`doc:${d.category}`);
    for (const cat of policies) keys.add(`policy:${cat.title}`);
    return keys;
  });

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Normalise both data sources into one uniform shape so the layout stays
  // consistent instead of two stacked, differently-shaped blocks.
  const catMeta = useMemo(() => {
    const map = new Map<string, { label: string; icon: string }>();
    for (const c of categories) map.set(c.key, { label: c.label, icon: c.icon });
    return map;
  }, [categories]);

  const allCollections = useMemo<Collection[]>(() => {
    const docMap = new Map<string, ResourceDocumentWithUrl[]>();
    for (const d of documents) {
      const arr = docMap.get(d.category) ?? [];
      arr.push(d);
      docMap.set(d.category, arr);
    }

    const docCollections: Collection[] = [...docMap.entries()]
      .map(([category, docs]) => {
        const meta = catMeta.get(category) ?? resourceCategoryMeta(category);
        return {
          key: `doc:${category}`,
          label: meta.label,
          icon: meta.icon,
          kind: "document" as const,
          accent: "text-emerald-700",
          categoryKey: category,
          managed: true,
          items: docs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            href: doc.signed_url,
            description: doc.description,
            meta: formatBytes(doc.size_bytes),
            staffOnly: doc.staff_only,
            docId: doc.id,
            isLink: !doc.storage_path && !!doc.source_url,
            category: doc.category,
            sourceUrl: doc.source_url,
          })),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const policyCollections: Collection[] = policies.map((cat) => ({
      key: `policy:${cat.title}`,
      label: cat.title,
      icon: cat.icon,
      kind: "policy" as const,
      accent: cat.accent,
      items: cat.links.map((link) => ({
        id: link.url,
        title: link.name,
        href: link.url,
      })),
    }));

    return [...docCollections, ...policyCollections];
  }, [documents, policies, catMeta]);

  const filtered = useMemo<Collection[]>(() => {
    const q = query.trim().toLowerCase();
    return allCollections
      .filter((c) => activeKind === "all" || c.kind === activeKind)
      .map((c) => {
        if (!q) return c;
        const labelMatch = c.label.toLowerCase().includes(q);
        const items = labelMatch
          ? c.items
          : c.items.filter(
              (it) =>
                it.title.toLowerCase().includes(q) ||
                (it.description ?? "").toLowerCase().includes(q),
            );
        return { ...c, items };
      })
      .filter((c) => c.items.length > 0);
  }, [allCollections, activeKind, query]);

  const totals = useMemo(() => {
    const docCount = documents.length;
    const policyCount = policies.reduce((n, c) => n + c.links.length, 0);
    return { docCount, policyCount, all: docCount + policyCount };
  }, [documents, policies]);

  const visibleCount = filtered.reduce((n, c) => n + c.items.length, 0);
  const allCollapsed =
    filtered.length > 0 && filtered.every((c) => collapsed.has(c.key));

  const collapseAll = () =>
    setCollapsed(new Set(filtered.map((c) => c.key)));
  const expandAll = () => setCollapsed(new Set());

  return (
    <div className="space-y-5">
      {/* Sticky toolbar keeps search + filters in reach without scrolling. */}
      <div className="sticky top-0 z-10 -mx-1 rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            >
              🔍
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter policies and documents…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-slate-100 p-1">
            <FilterTab
              label="All"
              count={totals.all}
              active={activeKind === "all"}
              onClick={() => setActiveKind("all")}
            />
            <FilterTab
              label="Documents"
              count={totals.docCount}
              active={activeKind === "document"}
              onClick={() => setActiveKind("document")}
            />
            <FilterTab
              label="Policies"
              count={totals.policyCount}
              active={activeKind === "policy"}
              onClick={() => setActiveKind("policy")}
            />
          </div>
        </div>
      </div>

      {canUpload ? <UploadPanel categories={categories} /> : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-10 text-center">
          <span className="text-3xl" aria-hidden>
            🗂️
          </span>
          <p className="mt-2 text-sm font-medium text-slate-700">
            Nothing matches “{query}”
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Try a different keyword or clear the filter.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-slate-400">
              Showing {visibleCount} item{visibleCount === 1 ? "" : "s"} across{" "}
              {filtered.length}{" "}
              {filtered.length === 1 ? "category" : "categories"}
            </p>
            <button
              type="button"
              onClick={allCollapsed ? expandAll : collapseAll}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          </div>

          {/* Masonry columns pack the cards tightly to avoid empty gaps. */}
          <div className="gap-4 sm:columns-2 lg:columns-3">
            {filtered.map((c) => (
              <CollectionCard
                key={c.key}
                collection={c}
                open={!collapsed.has(c.key)}
                onToggle={() => toggleCollapsed(c.key)}
                canManage={canUpload}
                onEditItem={setEditItem}
                onManageCategory={setManageCat}
              />
            ))}
          </div>
        </>
      )}

      {canUpload && editItem ? (
        <DocumentEditModal
          item={editItem}
          categories={categories}
          onClose={() => setEditItem(null)}
        />
      ) : null}
      {canUpload && manageCat ? (
        <CategoryEditModal
          collection={manageCat}
          onClose={() => setManageCat(null)}
        />
      ) : null}
    </div>
  );
}

function UploadPanel({ categories }: { categories: ResourceCategory[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [result, formAction] = useActionState<UploadResult | null, FormData>(
    uploadPolicyDocument,
    null,
  );

  useEffect(() => {
    if (result?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [result]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span aria-hidden className="text-base">
          ⬆️
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-800">
          Upload a new policy
        </span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>

      {open ? (
        <div className="border-t border-slate-100">
          <form
            ref={formRef}
            action={formAction}
            className="grid gap-4 p-4 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-500">Title</span>
              <input
                name="title"
                placeholder="e.g. Updated PTO Policy"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">
                Category
              </span>
              <select
                name="category"
                defaultValue="general"
                required
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {categories.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {cat.icon} {cat.label}
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
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-500">
                Description <span className="text-slate-400">(optional)</span>
              </span>
              <textarea
                name="description"
                rows={2}
                placeholder="Short summary of what this document covers."
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                name="staff_only"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-slate-600">Staff only</span>
            </label>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SubmitButton />
              <span className="text-xs text-slate-400">
                PDF or Word document · max 25 MB.
              </span>
              {result?.ok === false ? (
                <span className="text-sm text-red-600">{result.error}</span>
              ) : null}
            </div>
          </form>

          <NewLinkForm categories={categories} />
          <NewCategoryForm />
        </div>
      ) : null}
    </div>
  );
}

function NewLinkForm({ categories }: { categories: ResourceCategory[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<UploadResult | null, FormData>(
    createResourceLink,
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-2"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
        🔗 Add a link
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Title</span>
        <input
          name="title"
          required
          placeholder="e.g. AVMA Practice Management"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Category</span>
        <select
          name="category"
          defaultValue="general"
          required
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          {categories.map((cat) => (
            <option key={cat.key} value={cat.key}>
              {cat.icon} {cat.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs font-medium text-slate-500">Link URL</span>
        <input
          name="source_url"
          type="url"
          required
          placeholder="https://…"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>

      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs font-medium text-slate-500">
          Description <span className="text-slate-400">(optional)</span>
        </span>
        <input
          name="description"
          placeholder="Short summary of what this link covers."
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>

      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          name="staff_only"
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm text-slate-600">Staff only</span>
      </label>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <NewLinkButton />
        {result?.ok === false ? (
          <span className="text-sm text-red-600">{result.error}</span>
        ) : null}
      </div>
    </form>
  );
}

function NewLinkButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add link"}
    </button>
  );
}

function NewCategoryForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<UploadResult | null, FormData>(
    createResourceCategory,
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-end"
    >
      <label className="flex w-16 flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Icon</span>
        <input
          name="icon"
          maxLength={4}
          placeholder="📄"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-center text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">
          New category name
        </span>
        <input
          name="label"
          required
          placeholder="e.g. CVMA, Compliance, Onboarding"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>
      <div className="flex items-center gap-3">
        <NewCategoryButton />
        {result?.ok === false ? (
          <span className="text-sm text-red-600">{result.error}</span>
        ) : null}
      </div>
    </form>
  );
}

function NewCategoryButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding…" : "＋ Add category"}
    </button>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload policy"}
    </button>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
          : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          active
            ? "bg-slate-100 text-slate-600"
            : "bg-slate-200/70 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function CollectionCard({
  collection,
  open,
  onToggle,
  canManage = false,
  onEditItem,
  onManageCategory,
}: {
  collection: Collection;
  open: boolean;
  onToggle: () => void;
  canManage?: boolean;
  onEditItem?: (item: CollectionItem) => void;
  onManageCategory?: (collection: Collection) => void;
}) {
  const kind = KIND_META[collection.kind];
  const showCategoryManage = canManage && collection.managed;
  return (
    <div className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className={`flex w-full items-center gap-2 bg-slate-50/70 px-4 py-2.5 text-left ${
          open ? "border-b border-slate-100" : ""
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 truncate transition hover:opacity-80"
        >
          <span aria-hidden className="text-base">
            {collection.icon}
          </span>
          <span
            className={`flex-1 truncate text-sm font-semibold ${collection.accent}`}
          >
            {collection.label}
          </span>
        </button>
        {showCategoryManage ? (
          <button
            type="button"
            onClick={() => onManageCategory?.(collection)}
            aria-label={`Manage ${collection.label} category`}
            title="Edit or delete this category"
            className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700"
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="currentColor"
            >
              <path d="M8 3a1 1 0 0 1 2 0v.34a6 6 0 0 1 1.35.56l.24-.24a1 1 0 0 1 1.42 1.42l-.24.24q.34.63.56 1.35H14a1 1 0 0 1 0 2h-.34a6 6 0 0 1-.56 1.35l.24.24a1 1 0 0 1-1.42 1.42l-.24-.24a6 6 0 0 1-1.35.56V14a1 1 0 0 1-2 0v-.34a6 6 0 0 1-1.35-.56l-.24.24a1 1 0 0 1-1.42-1.42l.24-.24A6 6 0 0 1 3.34 10H3a1 1 0 0 1 0-2h.34a6 6 0 0 1 .56-1.35l-.24-.24a1 1 0 0 1 1.42-1.42l.24.24A6 6 0 0 1 6.66 3.34V3Zm1 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          className="shrink-0"
        >
          <span
            className={`mr-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${kind.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${kind.dot}`} />
            {collection.items.length}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`inline h-4 w-4 shrink-0 text-slate-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </button>
      </div>
      <ul className={`divide-y divide-slate-100 ${open ? "" : "hidden"}`}>
        {collection.items.map((item) => {
          const canEditItem = canManage && !!item.docId;
          return (
            <li key={item.id} className="flex items-stretch">
              <a
                href={item.href ?? "#"}
                target={item.href ? "_blank" : undefined}
                rel={item.href ? "noopener noreferrer" : undefined}
                aria-disabled={item.href ? undefined : true}
                className={`flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-2.5 text-sm transition ${
                  item.href ? kind.hover : "cursor-not-allowed opacity-60"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">
                    <span aria-hidden>{item.isLink ? "🔗" : "📄"}</span>
                    <span className="truncate">{item.title}</span>
                    {item.staffOnly ? (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                        Staff only
                      </span>
                    ) : null}
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 pt-0.5">
                  {item.meta ? (
                    <span className="text-xs text-slate-400">{item.meta}</span>
                  ) : null}
                  <span className="text-slate-300" aria-hidden>
                    ↗
                  </span>
                </span>
              </a>
              {canEditItem ? (
                <button
                  type="button"
                  onClick={() => onEditItem?.(item)}
                  aria-label={`Edit ${item.title}`}
                  title="Edit or delete"
                  className="shrink-0 border-l border-slate-100 px-2.5 text-slate-400 transition hover:bg-slate-50 hover:text-emerald-700"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="currentColor"
                  >
                    <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-8.5 8.5a1 1 0 0 1-.44.263l-3 .857a.5.5 0 0 1-.618-.618l.857-3a1 1 0 0 1 .263-.44l8.5-8.5Z" />
                  </svg>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DocumentEditModal({
  item,
  categories,
  onClose,
}: {
  item: CollectionItem;
  categories: ResourceCategory[];
  onClose: () => void;
}) {
  const [saveResult, saveAction] = useActionState<UploadResult | null, FormData>(
    updateResourceDocument,
    null,
  );
  const [deleteResult, deleteAction] = useActionState<
    UploadResult | null,
    FormData
  >(deleteResourceDocument, null);

  useEffect(() => {
    if (saveResult?.ok || deleteResult?.ok) onClose();
  }, [saveResult, deleteResult, onClose]);

  const error =
    saveResult?.ok === false
      ? saveResult.error
      : deleteResult?.ok === false
        ? deleteResult.error
        : null;

  return (
    <Modal
      title={item.isLink ? "Edit link" : "Edit document"}
      onClose={onClose}
    >
      <form action={saveAction} className="grid gap-4 p-4">
        <input type="hidden" name="id" value={item.docId} />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input
            name="title"
            required
            defaultValue={item.title}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Category</span>
          <select
            name="category"
            defaultValue={item.category ?? "general"}
            required
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {categories.map((cat) => (
              <option key={cat.key} value={cat.key}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>
        </label>

        {item.isLink ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Link URL</span>
            <input
              name="source_url"
              type="url"
              required
              defaultValue={item.sourceUrl ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">
            Description <span className="text-slate-400">(optional)</span>
          </span>
          <textarea
            name="description"
            rows={2}
            defaultValue={item.description ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            name="staff_only"
            type="checkbox"
            defaultChecked={item.staffOnly}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm text-slate-600">Staff only</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <PendingButton
            label="Save changes"
            pendingLabel="Saving…"
            variant="primary"
          />
        </div>
      </form>

      <form
        action={deleteAction}
        className="border-t border-slate-100 bg-slate-50/60 px-4 py-3"
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Delete "${item.title}"? This can't be undone.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={item.docId} />
        <PendingButton
          label="Delete"
          pendingLabel="Deleting…"
          variant="danger"
        />
      </form>
    </Modal>
  );
}

function CategoryEditModal({
  collection,
  onClose,
}: {
  collection: Collection;
  onClose: () => void;
}) {
  const [saveResult, saveAction] = useActionState<UploadResult | null, FormData>(
    updateResourceCategory,
    null,
  );
  const [deleteResult, deleteAction] = useActionState<
    UploadResult | null,
    FormData
  >(deleteResourceCategory, null);

  useEffect(() => {
    if (saveResult?.ok || deleteResult?.ok) onClose();
  }, [saveResult, deleteResult, onClose]);

  const error =
    saveResult?.ok === false
      ? saveResult.error
      : deleteResult?.ok === false
        ? deleteResult.error
        : null;

  return (
    <Modal title="Manage category" onClose={onClose}>
      <form action={saveAction} className="grid gap-4 p-4">
        <input type="hidden" name="key" value={collection.categoryKey} />
        <div className="flex gap-3">
          <label className="flex w-16 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Icon</span>
            <input
              name="icon"
              maxLength={4}
              defaultValue={collection.icon}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-center text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">
              Category name
            </span>
            <input
              name="label"
              required
              defaultValue={collection.label}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <PendingButton
          label="Save changes"
          pendingLabel="Saving…"
          variant="primary"
        />
      </form>

      <form
        action={deleteAction}
        className="border-t border-slate-100 bg-slate-50/60 px-4 py-3"
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Delete the "${collection.label}" category? It must be empty first.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="key" value={collection.categoryKey} />
        <PendingButton
          label="Delete category"
          pendingLabel="Deleting…"
          variant="danger"
        />
        <span className="ml-3 text-xs text-slate-400">
          Only empty categories can be deleted.
        </span>
      </form>
    </Modal>
  );
}

function PendingButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : "border border-red-300 text-red-700 hover:bg-red-50";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
