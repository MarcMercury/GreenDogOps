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
import { OpportunityBadge } from "../_components/opportunity-type-field";
import { opportunityShortLabel } from "@/lib/shared/opportunity-types";

function candidateName(r: CandidateRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AtsExplorer({ rows }: { rows: CandidateRow[] }) {
  const router = useRouter();

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const b = bucketForStage(r.person_recruiting?.stage ?? null);
    counts[b] = (counts[b] ?? 0) + 1;
  }

  const upcomingInterviews = rows.filter(
    (r) => r.interview_meta?.next_date,
  ).length;

  const stats: Stat[] = [
    { label: "Total", value: String(rows.length), tone: "text-emerald-700" },
    { label: "Active", value: String(counts.active ?? 0), tone: "text-emerald-600" },
    { label: "Interviews Set", value: String(upcomingInterviews), tone: "text-violet-700" },
    { label: "Hired", value: String(counts.hired ?? 0), tone: "text-indigo-700" },
    { label: "Keep for Future", value: String(counts.future ?? 0), tone: "text-sky-700" },
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
      key: "opportunity",
      header: "Opportunity",
      value: (r) => opportunityShortLabel(r.opportunity_type),
      render: (r) => <OpportunityBadge value={r.opportunity_type} />,
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
    {
      key: "next_interview",
      header: "Next Interview",
      value: (r) => fmtDate(r.interview_meta?.next_date),
      render: (r) => {
        const d = fmtDate(r.interview_meta?.next_date);
        return d ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
            📅 {d}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      key: "grade",
      header: "Grade",
      value: (r) => r.interview_meta?.last_grade ?? null,
      render: (r) => {
        const g = r.interview_meta?.last_grade;
        return g ? (
          <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
            {g}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
      className: "text-center",
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
    {
      key: "opportunity",
      label: "Opportunity",
      value: (r) => opportunityShortLabel(r.opportunity_type) || null,
    },
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
