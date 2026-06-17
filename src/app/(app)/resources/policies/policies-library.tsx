"use client";

import { useMemo, useState } from "react";
import {
  formatBytes,
  resourceCategoryMeta,
  type PolicyCategory,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";

export function PoliciesLibrary({
  documents,
  policies,
}: {
  documents: ResourceDocumentWithUrl[];
  policies: PolicyCategory[];
}) {
  const [query, setQuery] = useState("");

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) =>
      [d.title, d.description, d.category]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [documents, query]);

  const docsByCategory = useMemo(() => {
    const map = new Map<string, ResourceDocumentWithUrl[]>();
    for (const d of filteredDocs) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return [...map.entries()].sort((a, b) =>
      resourceCategoryMeta(a[0]).label.localeCompare(
        resourceCategoryMeta(b[0]).label,
      ),
    );
  }, [filteredDocs]);

  const filteredPolicies = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return policies;
    return policies
      .map((cat) => ({
        ...cat,
        links: cat.links.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            cat.title.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.links.length > 0);
  }, [policies, query]);

  return (
    <div className="space-y-8">
      <div className="relative">
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
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-96"
        />
      </div>

      {/* Document library (uploaded PDFs) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Document Library
          </h2>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
            {documents.length} file{documents.length === 1 ? "" : "s"}
          </span>
        </div>

        {docsByCategory.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No documents match your filter.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {docsByCategory.map(([category, docs]) => {
              const meta = resourceCategoryMeta(category);
              return (
                <div
                  key={category}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2">
                    <span aria-hidden>{meta.icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {meta.label}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {docs.map((doc) => (
                      <li key={doc.id}>
                        <a
                          href={doc.signed_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-disabled={doc.signed_url ? undefined : true}
                          className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition ${
                            doc.signed_url
                              ? "hover:bg-emerald-50/50"
                              : "cursor-not-allowed opacity-60"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium text-slate-800">
                              <span aria-hidden>📄</span>
                              <span className="truncate">{doc.title}</span>
                              {doc.staff_only ? (
                                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                  Staff only
                                </span>
                              ) : null}
                            </span>
                            {doc.description ? (
                              <span className="mt-0.5 block truncate text-xs text-slate-500">
                                {doc.description}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {formatBytes(doc.size_bytes)}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Policy quick links (Google Docs) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Company Policies & Important Links
          </h2>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">
            Google Docs
          </span>
        </div>

        {filteredPolicies.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No policies match your filter.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {filteredPolicies.map((cat) => (
              <div
                key={cat.title}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <span aria-hidden>{cat.icon}</span>
                  <span className={`text-sm font-semibold ${cat.accent}`}>
                    {cat.title}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {cat.links.map((link) => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-blue-50/50"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span aria-hidden>📄</span>
                          <span className="truncate">{link.name}</span>
                        </span>
                        <span className="shrink-0 text-slate-300" aria-hidden>
                          ↗
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
