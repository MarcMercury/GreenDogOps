"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { globalSearch } from "./actions";
import type { GlobalSearchResult } from "./search-types";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [includeWeb, setIncludeWeb] = useState(true);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startTransition(async () => {
      const res = await globalSearch(q, includeWeb);
      setResult(res);
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={runSearch} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
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
              placeholder="Search people, CRM, vendors, policies — or ask the web…"
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !query.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Searching…" : "Search"}
          </button>
        </div>
        <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeWeb}
            onChange={(e) => setIncludeWeb(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Also search the web with AI
        </label>
      </form>

      {isPending && !result ? (
        <p className="text-sm text-slate-500">Searching…</p>
      ) : null}

      {result ? <Results result={result} pending={isPending} /> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center">
      <span className="text-3xl" aria-hidden>
        🔎
      </span>
      <p className="mt-2 text-sm font-medium text-slate-700">
        Search everything in Green Dog Ops
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Find employees, applicants, CRM organizations and contacts, referral
        partners, and influencers. Turn on AI web search to also pull in
        external results from the internet.
      </p>
    </div>
  );
}

function Results({
  result,
  pending,
}: {
  result: GlobalSearchResult;
  pending: boolean;
}) {
  return (
    <div className="space-y-8">
      {/* Internal */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Internal results
          </h2>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
            Program data
          </span>
          <span className="text-xs text-slate-400">
            {result.internalCount} match
            {result.internalCount === 1 ? "" : "es"}
          </span>
        </div>

        {result.internal.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No matching records in Green Dog Ops for “{result.query}”.
          </p>
        ) : (
          <div className="space-y-4">
            {result.internal.map((group) => (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2">
                  <span aria-hidden>{group.icon}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {group.hits.length}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {group.hits.map((hit) => (
                    <li key={hit.id}>
                      <Link
                        href={hit.href}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-emerald-50/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">
                            {hit.label}
                          </span>
                          {hit.sublabel ? (
                            <span className="block truncate text-xs text-slate-500">
                              {hit.sublabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-slate-300" aria-hidden>
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* External / web */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            External results
          </h2>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">
            AI web search
          </span>
        </div>

        {pending && result.web === null ? (
          <p className="text-sm text-slate-500">Searching the web…</p>
        ) : null}

        {result.web === null ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Web search was turned off for this query.
          </p>
        ) : result.web.ok ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {result.web.answer}
            </p>
            {result.web.sources.length > 0 ? (
              <div className="mt-3 border-t border-blue-100 pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sources
                </p>
                <ul className="space-y-1">
                  {result.web.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-700 underline-offset-2 hover:underline"
                      >
                        ↗ {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {result.web.error}
          </p>
        )}
      </section>
    </div>
  );
}
