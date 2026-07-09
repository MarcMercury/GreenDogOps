"use client";

import { useRouter } from "next/navigation";
import {
  type RosterRow,
  type EmploymentStatus,
  STATUS_LABELS,
  WORK_LOCATION_LABELS,
  SCHEDULE_LABELS,
} from "@/lib/hr/types";
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
import { NewEmployeeWizard } from "./new-employee-wizard";

const STATUS_BADGE: Record<EmploymentStatus, string> = {
  prospect: "bg-amber-100 text-amber-800",
  applicant: "bg-blue-100 text-blue-800",
  employee: "bg-emerald-100 text-emerald-800",
  former: "bg-slate-200 text-slate-600",
  contractor: "bg-violet-100 text-violet-800",
};

function displayName(r: RosterRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return r.grid_name ?? "—";
}

function jobTitle(r: RosterRow): string | null {
  return r.person_employment?.adp_job_title ?? r.person_employment?.offer_title ?? null;
}

function formatHireDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const dt = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RosterGrid({
  rows,
  canEdit,
}: {
  rows: RosterRow[];
  canEdit: boolean;
}) {
  const router = useRouter();

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const byLocation = (loc: string) =>
    rows.filter((r) => r.work_location_type === loc).length;

  const stats: Stat[] = [
    { label: "Total", value: String(rows.length), tone: "text-emerald-700" },
    { label: "Current", value: String(counts.employee ?? 0), tone: "text-emerald-600" },
    { label: "Former", value: String(counts.former ?? 0), tone: "text-slate-500" },
    { label: "Contractors", value: String(counts.contractor ?? 0), tone: "text-violet-700" },
    { label: "In-House", value: String(byLocation("in_house")), tone: "text-sky-700" },
    { label: "Remote", value: String(byLocation("remote")), tone: "text-indigo-700" },
  ];

  const columns: Column<RosterRow>[] = [
    {
      key: "name",
      header: "Name",
      value: displayName,
      render: (r) => (
        <span className="font-medium text-slate-900">{displayName(r)}</span>
      ),
    },
    { key: "email", header: "Email", value: (r) => r.email },
    { key: "title", header: "Title", value: jobTitle },
    {
      key: "location",
      header: "Location",
      value: (r) =>
        r.work_location_type ? WORK_LOCATION_LABELS[r.work_location_type] : null,
    },
    {
      key: "schedule",
      header: "Schedule",
      value: (r) =>
        r.person_employment?.work_schedule
          ? SCHEDULE_LABELS[r.person_employment.work_schedule]
          : null,
    },
    {
      key: "opportunity",
      header: "Opportunity",
      value: (r) => opportunityShortLabel(r.opportunity_type),
      render: (r) => <OpportunityBadge value={r.opportunity_type} />,
    },
    {
      key: "hire_date",
      header: "Hire Date",
      value: (r) => r.person_employment?.hire_date,
      render: (r) => formatHireDate(r.person_employment?.hire_date),
    },
    {
      key: "status",
      header: "Status",
      value: (r) => STATUS_LABELS[r.status],
      render: (r) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}
        >
          {STATUS_LABELS[r.status]}
        </span>
      ),
    },
  ];

  const filters: FilterDef<RosterRow>[] = [
    { key: "status", label: "Status", value: (r) => STATUS_LABELS[r.status] },
    {
      key: "location",
      label: "Location",
      value: (r) =>
        r.work_location_type ? WORK_LOCATION_LABELS[r.work_location_type] : null,
    },
    {
      key: "schedule",
      label: "Schedule",
      value: (r) =>
        r.person_employment?.work_schedule
          ? SCHEDULE_LABELS[r.person_employment.work_schedule]
          : null,
    },
    {
      key: "schedule_type",
      label: "Schedule Type",
      value: (r) => r.person_employment?.schedule_type ?? null,
    },
    {
      key: "opportunity",
      label: "Opportunity",
      value: (r) => opportunityShortLabel(r.opportunity_type) || null,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <ModuleHeader
        icon="👥"
        eyebrow="People"
        title="HR / Roster"
        description="Employee roster, status & assignments"
        count={rows.length}
        countLabel="people"
        onExport={() => exportColumnsCsv("hr-roster", columns, rows)}
        onImport={(f) => previewCsvImport(f, "person")}
        actions={canEdit ? <NewEmployeeWizard /> : null}
      />

      <StatGrid stats={stats} />

      <DataTable
        rows={rows}
        columns={columns}
        filters={filters}
        initialActive={{ status: STATUS_LABELS.employee }}
        searchPlaceholder="Search name, title, email…"
        searchExtra={(r) => [
          r.grid_name,
          r.email,
          r.person_employment?.adp_job_title,
          r.person_employment?.offer_title,
        ]}
        onRowClick={(r) => router.push(`/hr/${r.id}`)}
        emptyLabel="No people match your filters."
      />
    </div>
  );
}
