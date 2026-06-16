"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type CandidateRow,
  type StageBucket,
  bucketForStage,
  STAGE_BUCKET_LABELS,
  STAGE_BADGE,
} from "@/lib/ats/types";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

const BUCKETS: Array<StageBucket | "all"> = [
  "all",
  "active",
  "hired",
  "future",
  "no_response",
  "passed",
  "other",
];

export function AtsExplorer({ rows }: { rows: CandidateRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<StageBucket | "all">("all");
  const [pipeline, setPipeline] = useState<string>("all");

  const pipelines = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const p = r.person_recruiting?.pipeline;
      if (p) set.add(p);
    }
    return Array.from(set).sort();
  }, [rows]);

  const bucketCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) {
      const b = bucketForStage(r.person_recruiting?.stage ?? null);
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const rec = r.person_recruiting;
      if (bucket !== "all" && bucketForStage(rec?.stage ?? null) !== bucket)
        return false;
      if (pipeline !== "all" && rec?.pipeline !== pipeline) return false;
      if (!q) return true;
      return [
        candidateName(r),
        r.email,
        rec?.target_title,
        rec?.pipeline,
        rec?.source,
        rec?.status_notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, bucket, pipeline]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Recruiting (ATS)
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered.length} of {rows.length} candidates
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, position, source…"
          className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {BUCKETS.map((b) => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              bucket === b
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {b === "all" ? "All" : STAGE_BUCKET_LABELS[b]}
            <span className="ml-1.5 opacity-70">
              {b === "all" ? bucketCounts.all : (bucketCounts[b] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <select
          value={pipeline}
          onChange={(e) => setPipeline(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="all">All pipelines</option>
          {pipelines.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Pipeline</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const rec = r.person_recruiting;
              const b = bucketForStage(rec?.stage ?? null);
              return (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/ats/${r.id}`)}
                  className="cursor-pointer transition hover:bg-emerald-50"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {candidateName(r)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {rec?.target_title ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {rec?.pipeline ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_BADGE[b]}`}
                    >
                      {rec?.stage ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {rec?.source ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {rec?.score != null && rec.score > 0 ? rec.score : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  No candidates match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
