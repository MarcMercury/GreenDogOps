"use client";

import { useRouter } from "next/navigation";
import {
  type CandidateRow,
  bucketForStage,
  STAGE_BUCKET_LABELS,
  STAGE_BADGE,
} from "@/lib/ats/types";
import {
  type Stat,
  type Column,
  type FilterDef,
  StatGrid,
  DataTable,
  ModuleHeader,
  exportColumnsCsv,
  previewCsvImport,
} from "../_components/data-views";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

export function AtsExplorer({ rows }: { rows: CandidateRow[] }) {
  const router = useRouter();

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const b = bucketForStage(r.person_recruiting?.stage ?? null);
    counts[b] = (counts[b] ?? 0) + 1;
  }

  const stats: Stat[] = [
    { label: "Total", value: String(rows.length), tone: "text-emerald-700" },
    { label: "Active", value: String(counts.active ?? 0), tone: "text-emerald-600" },
    { label: "Hired", value: String(counts.hired ?? 0), tone: "text-indigo-700" },
    { label: "Keep for Future", value: String(counts.future ?? 0), tone: "text-sky-700" },
    { label: "No Response", value: String(counts.no_response ?? 0), tone: "text-amber-600" },
    { label: "Passed", value: String(counts.passed ?? 0), tone: "text-red-600" },
  ];

  const columns: Column<CandidateRow>[] = [
    {
      key: "name",
      header: "Name",
      value: candidateName,
      render: (r) => (
        <span className="font-medium text-slate-900">{candidateName(r)}</span>
      ),
    },
    {
      key: "position",
      header: "Position",
      value: (r) => r.person_recruiting?.target_title,
    },
    {
      key: "pipeline",
      header: "Pipeline",
      value: (r) => r.person_recruiting?.pipeline,
    },
    {
      key: "stage",
      header: "Stage",
      value: (r) => r.person_recruiting?.stage,
      render: (r) => {
        const b = bucketForStage(r.person_recruiting?.stage ?? null);
        return (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_BADGE[b]}`}
          >
            {r.person_recruiting?.stage ?? "—"}
          </span>
        );
      },
    },
    {
      key: "source",
      header: "Source",
      value: (r) => r.person_recruiting?.source,
    },
    {
      key: "score",
      header: "Score",
      value: (r) => {
        const s = r.person_recruiting?.score;
        return s != null && s > 0 ? s : null;
      },
      className: "tabular-nums",
    },
  ];

  const filters: FilterDef<CandidateRow>[] = [
    {
      key: "stage_group",
      label: "Stage",
      value: (r) => STAGE_BUCKET_LABELS[bucketForStage(r.person_recruiting?.stage ?? null)],
    },
    { key: "pipeline", label: "Pipeline", value: (r) => r.person_recruiting?.pipeline },
    { key: "source", label: "Source", value: (r) => r.person_recruiting?.source },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon="🎯"
        eyebrow="Recruiting"
        title="Recruiting (ATS)"
        description="Candidate pipeline, stages & outreach"
        count={rows.length}
        countLabel="candidates"
        onExport={() => exportColumnsCsv("recruiting-ats", columns, rows)}
        onImport={(f) => previewCsvImport(f, "candidate")}
      />

      <StatGrid stats={stats} />

      <DataTable
        rows={rows}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search name, position, source…"
        searchExtra={(r) => [
          r.email,
          r.person_recruiting?.target_title,
          r.person_recruiting?.pipeline,
          r.person_recruiting?.source,
          r.person_recruiting?.status_notes,
        ]}
        onRowClick={(r) => router.push(`/ats/${r.id}`)}
        emptyLabel="No candidates match your filters."
      />
    </div>
  );
}
