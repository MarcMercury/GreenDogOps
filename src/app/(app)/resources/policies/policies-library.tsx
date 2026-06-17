"use client";

import { useMemo, useState } from "react";
import {
  formatBytes,
  resourceCategoryMeta,
  type PolicyCategory,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";

type CollectionItem = {
  id: string;
  title: string;
  href: string | null;
  description?: string | null;
  meta?: string | null;
  staffOnly?: boolean;
};

type Collection = {
  key: string;
  label: string;
  icon: string;
  kind: "document" | "policy";
  accent: string;
  items: CollectionItem[];
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
}: {
  documents: ResourceDocumentWithUrl[];
  policies: PolicyCategory[];
}) {
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<"all" | "document" | "policy">(
    "all",
  );

  // Normalise both data sources into one uniform shape so the layout stays
  // consistent instead of two stacked, differently-shaped blocks.
  const allCollections = useMemo<Collection[]>(() => {
    const docMap = new Map<string, ResourceDocumentWithUrl[]>();
    for (const d of documents) {
      const arr = docMap.get(d.category) ?? [];
      arr.push(d);
      docMap.set(d.category, arr);
    }

    const docCollections: Collection[] = [...docMap.entries()]
      .map(([category, docs]) => {
        const meta = resourceCategoryMeta(category);
        return {
          key: `doc:${category}`,
          label: meta.label,
          icon: meta.icon,
          kind: "document" as const,
          accent: "text-emerald-700",
          items: docs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            href: doc.signed_url,
            description: doc.description,
            meta: formatBytes(doc.size_bytes),
            staffOnly: doc.staff_only,
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
  }, [documents, policies]);

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
          <p className="px-1 text-xs text-slate-400">
            Showing {visibleCount} item{visibleCount === 1 ? "" : "s"} across{" "}
            {filtered.length}{" "}
            {filtered.length === 1 ? "category" : "categories"}
          </p>

          {/* Masonry columns pack the cards tightly to avoid empty gaps. */}
          <div className="gap-4 sm:columns-2 lg:columns-3">
            {filtered.map((c) => (
              <CollectionCard key={c.key} collection={c} />
            ))}
          </div>
        </>
      )}
    </div>
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

function CollectionCard({ collection }: { collection: Collection }) {
  const kind = KIND_META[collection.kind];
  return (
    <div className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <span aria-hidden className="text-base">
          {collection.icon}
        </span>
        <span
          className={`flex-1 truncate text-sm font-semibold ${collection.accent}`}
        >
          {collection.label}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${kind.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${kind.dot}`} />
          {collection.items.length}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {collection.items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href ?? "#"}
              target={item.href ? "_blank" : undefined}
              rel={item.href ? "noopener noreferrer" : undefined}
              aria-disabled={item.href ? undefined : true}
              className={`flex items-start justify-between gap-3 px-4 py-2.5 text-sm transition ${
                item.href ? kind.hover : "cursor-not-allowed opacity-60"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-slate-800">
                  <span aria-hidden>📄</span>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
