"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type RosterRow,
  type EmploymentStatus,
  STATUS_LABELS,
  WORK_LOCATION_LABELS,
  SCHEDULE_LABELS,
  PAY_TYPE_LABELS,
  SCHEDULE_TYPE_OPTIONS,
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
import { opportunityShortLabel, OPPORTUNITY_TYPES } from "@/lib/shared/opportunity-types";
import { NewEmployeeWizard } from "./new-employee-wizard";
import { EditableCell, type SelectOption } from "./editable-cell";

const STATUS_BADGE: Record<EmploymentStatus, string> = {
  prospect: "bg-amber-100 text-amber-800",
  applicant: "bg-blue-100 text-blue-800",
  employee: "bg-emerald-100 text-emerald-800",
  former: "bg-slate-200 text-slate-600",
  contractor: "bg-violet-100 text-violet-800",
};

const FLSA_LABELS: Record<string, string> = {
  exempt: "Exempt",
  non_exempt: "Non-Exempt",
};

const SEPARATION_TYPE_LABELS: Record<string, string> = {
  quit: "Quit",
  fired: "Fired",
  laid_off: "Laid Off",
  other: "Other",
};

/** Turn a code → label map into { value, label } options for a select editor. */
function toOptions(map: Record<string, string>): SelectOption[] {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

const WORK_LOCATION_OPTIONS = toOptions(WORK_LOCATION_LABELS);
const STATUS_OPTIONS = toOptions(STATUS_LABELS);
const FLSA_OPTIONS = toOptions(FLSA_LABELS);
const SCHEDULE_OPTIONS = toOptions(SCHEDULE_LABELS);
const SCHEDULE_TYPE_SELECT_OPTIONS: SelectOption[] = SCHEDULE_TYPE_OPTIONS.map(
  (v) => ({ value: v, label: v }),
);
const SEPARATION_TYPE_OPTIONS = toOptions(SEPARATION_TYPE_LABELS);
const PAY_TYPE_OPTIONS = toOptions(PAY_TYPE_LABELS);
const OPPORTUNITY_OPTIONS: SelectOption[] = OPPORTUNITY_TYPES.map((o) => ({
  value: o.value,
  label: o.label,
}));

function displayName(r: RosterRow): string {
  if (r.full_name) return r.full_name;
  const parts = [r.first_name, r.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return r.grid_name ?? "—";
}

function jobTitle(r: RosterRow): string | null {
  return r.person_employment?.adp_job_title ?? r.person_employment?.offer_title ?? null;
}

/** Format a numeric value as USD, or a dash when empty. */
function moneyCell(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Format an ISO date string as a locale date, or a dash when empty. */
function dateCell(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function RosterGrid({
  rows,
  canEdit,
  canViewAllComp = false,
}: {
  rows: RosterRow[];
  canEdit: boolean;
  canViewAllComp?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"standard" | "detailed">("standard");

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

  const nameColumn: Column<RosterRow> = {
    key: "name",
    header: "Name",
    value: displayName,
    sticky: true,
    render: (r) => (
      <span className="font-medium text-slate-900">{displayName(r)}</span>
    ),
  };

  const statusColumn: Column<RosterRow> = {
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
  };

  const standardColumns: Column<RosterRow>[] = [
    nameColumn,
    { key: "email", header: "Email", value: (r) => r.email },
    { key: "phone", header: "Primary Phone", value: (r) => r.phone_mobile },
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
    statusColumn,
  ];

  // Every field surfaced on the employee Overview + Compensation & Benefits
  // pages, flattened into one wide grid for Admin / HR-Manager review. When the
  // viewer can edit HR, cells become inline-editable and write straight back to
  // the same person / person_employment rows the individual profile uses.
  const editable = canEdit;
  const detailedColumns: Column<RosterRow>[] = [
    nameColumn,
    // — Overview: personal —
    {
      key: "grid_name",
      header: "Grid Name",
      value: (r) => r.grid_name,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="grid_name"
          kind="text"
          rawValue={r.grid_name}
          disabled={!editable}
        />
      ),
    },
    {
      key: "email",
      header: "Email",
      value: (r) => r.email,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="email"
          kind="text"
          rawValue={r.email}
          disabled={!editable}
        />
      ),
    },
    {
      key: "phone_mobile",
      header: "Cell Phone",
      value: (r) => r.phone_mobile,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="phone_mobile"
          kind="text"
          rawValue={r.phone_mobile}
          disabled={!editable}
        />
      ),
    },
    {
      key: "phone_home",
      header: "Home Phone",
      value: (r) => r.phone_home,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="phone_home"
          kind="text"
          rawValue={r.phone_home}
          disabled={!editable}
        />
      ),
    },
    {
      key: "phone_other",
      header: "Other Phone",
      value: (r) => r.phone_other,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="phone_other"
          kind="text"
          rawValue={r.phone_other}
          disabled={!editable}
        />
      ),
    },
    {
      key: "date_of_birth",
      header: "Date of Birth",
      value: (r) => r.date_of_birth,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="date_of_birth"
          kind="date"
          rawValue={r.date_of_birth}
          display={dateCell(r.date_of_birth)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "postal_code",
      header: "Postal Code",
      value: (r) => r.postal_code,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="postal_code"
          kind="text"
          rawValue={r.postal_code}
          disabled={!editable}
        />
      ),
    },
    {
      key: "location",
      header: "Work Location",
      value: (r) =>
        r.work_location_type ? WORK_LOCATION_LABELS[r.work_location_type] : null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="work_location_type"
          kind="select"
          options={WORK_LOCATION_OPTIONS}
          rawValue={r.work_location_type}
          display={
            r.work_location_type
              ? WORK_LOCATION_LABELS[r.work_location_type]
              : "—"
          }
          disabled={!editable}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (r) => STATUS_LABELS[r.status],
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="status"
          kind="select"
          options={STATUS_OPTIONS}
          rawValue={r.status}
          display={STATUS_LABELS[r.status]}
          disabled={!editable}
        />
      ),
    },
    {
      key: "opportunity",
      header: "Opportunity",
      value: (r) => opportunityShortLabel(r.opportunity_type) || null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="opportunity_type"
          kind="select"
          options={OPPORTUNITY_OPTIONS}
          rawValue={r.opportunity_type}
          display={opportunityShortLabel(r.opportunity_type) || "—"}
          disabled={!editable}
        />
      ),
    },
    // — Overview: job / position —
    {
      key: "adp_job_title",
      header: "ADP Job Title",
      value: (r) => r.person_employment?.adp_job_title ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="adp_job_title"
          kind="text"
          rawValue={r.person_employment?.adp_job_title ?? null}
          disabled={!editable}
        />
      ),
    },
    {
      key: "offer_title",
      header: "Offer Title",
      value: (r) => r.person_employment?.offer_title ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="offer_title"
          kind="text"
          rawValue={r.person_employment?.offer_title ?? null}
          disabled={!editable}
        />
      ),
    },
    {
      key: "flsa_status",
      header: "FLSA Status",
      value: (r) =>
        r.person_employment?.flsa_status
          ? FLSA_LABELS[r.person_employment.flsa_status]
          : null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="flsa_status"
          kind="select"
          options={FLSA_OPTIONS}
          rawValue={r.person_employment?.flsa_status ?? null}
          display={
            r.person_employment?.flsa_status
              ? FLSA_LABELS[r.person_employment.flsa_status]
              : "—"
          }
          disabled={!editable}
        />
      ),
    },
    {
      key: "work_schedule",
      header: "Work Schedule",
      value: (r) =>
        r.person_employment?.work_schedule
          ? SCHEDULE_LABELS[r.person_employment.work_schedule]
          : null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="work_schedule"
          kind="select"
          options={SCHEDULE_OPTIONS}
          rawValue={r.person_employment?.work_schedule ?? null}
          display={
            r.person_employment?.work_schedule
              ? SCHEDULE_LABELS[r.person_employment.work_schedule]
              : "—"
          }
          disabled={!editable}
        />
      ),
    },
    {
      key: "schedule_type",
      header: "Schedule Type",
      value: (r) => r.person_employment?.schedule_type ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="schedule_type"
          kind="select"
          options={SCHEDULE_TYPE_SELECT_OPTIONS}
          rawValue={r.person_employment?.schedule_type ?? null}
          disabled={!editable}
        />
      ),
    },
    {
      key: "days_per_week",
      header: "Days/Week",
      value: (r) => r.person_employment?.days_per_week ?? null,
    },
    {
      key: "hire_date",
      header: "Hire Date",
      value: (r) => r.person_employment?.hire_date ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="hire_date"
          kind="date"
          rawValue={r.person_employment?.hire_date ?? null}
          display={dateCell(r.person_employment?.hire_date)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "original_hire_date",
      header: "Original Hire Date",
      value: (r) => r.person_employment?.original_hire_date ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="original_hire_date"
          kind="date"
          rawValue={r.person_employment?.original_hire_date ?? null}
          display={dateCell(r.person_employment?.original_hire_date)}
          disabled={!editable}
        />
      ),
    },
    // — Overview: separation —
    {
      key: "separation_date",
      header: "Separation Date",
      value: (r) => r.person_employment?.separation_date ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="separation_date"
          kind="date"
          rawValue={r.person_employment?.separation_date ?? null}
          display={dateCell(r.person_employment?.separation_date)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "separation_type",
      header: "Separation Type",
      value: (r) =>
        r.person_employment?.separation_type
          ? SEPARATION_TYPE_LABELS[r.person_employment.separation_type]
          : null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="separation_type"
          kind="select"
          options={SEPARATION_TYPE_OPTIONS}
          rawValue={r.person_employment?.separation_type ?? null}
          display={
            r.person_employment?.separation_type
              ? SEPARATION_TYPE_LABELS[r.person_employment.separation_type]
              : "—"
          }
          disabled={!editable}
        />
      ),
    },
    {
      key: "separation_letter_signed",
      header: "Sep. Letter Signed",
      value: (r) => r.person_employment?.separation_letter_signed ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="separation_letter_signed"
          kind="checkbox"
          rawValue={r.person_employment?.separation_letter_signed ?? false}
          disabled={!editable}
        />
      ),
    },
    {
      key: "separation_notes",
      header: "Separation Notes",
      value: (r) => r.person_employment?.separation_notes ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="separation_notes"
          kind="text"
          rawValue={r.person_employment?.separation_notes ?? null}
          disabled={!editable}
        />
      ),
    },
    {
      key: "notes",
      header: "Notes",
      value: (r) => r.notes,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="notes"
          kind="text"
          rawValue={r.notes}
          disabled={!editable}
        />
      ),
    },
    // — Compensation & Benefits: compensation —
    {
      key: "pay_type",
      header: "Pay Type",
      value: (r) =>
        r.person_employment?.pay_type
          ? (PAY_TYPE_LABELS[r.person_employment.pay_type] ??
            r.person_employment.pay_type)
          : null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="pay_type"
          kind="select"
          options={PAY_TYPE_OPTIONS}
          rawValue={r.person_employment?.pay_type ?? null}
          display={
            r.person_employment?.pay_type
              ? (PAY_TYPE_LABELS[r.person_employment.pay_type] ??
                r.person_employment.pay_type)
              : "—"
          }
          disabled={!editable}
        />
      ),
    },
    {
      key: "current_rate",
      header: "Hourly Rate",
      value: (r) => r.person_employment?.current_rate ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="current_rate"
          kind="money"
          align="right"
          rawValue={r.person_employment?.current_rate ?? null}
          display={moneyCell(r.person_employment?.current_rate)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "biweekly_wage",
      header: "Biweekly Wage",
      value: (r) => r.person_employment?.biweekly_wage ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="biweekly_wage"
          kind="money"
          align="right"
          rawValue={r.person_employment?.biweekly_wage ?? null}
          display={moneyCell(r.person_employment?.biweekly_wage)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "annual_wages",
      header: "Annual Wages",
      value: (r) => r.person_employment?.annual_wages ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="annual_wages"
          kind="money"
          align="right"
          rawValue={r.person_employment?.annual_wages ?? null}
          display={moneyCell(r.person_employment?.annual_wages)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "last_review_date",
      header: "Last Review",
      value: (r) => r.person_employment?.last_review_date ?? null,
      render: (r) => dateCell(r.person_employment?.last_review_date),
    },
    {
      key: "latest_wage_change_date",
      header: "Last Comp Change",
      value: (r) => r.person_employment?.latest_wage_change_date ?? null,
      render: (r) => dateCell(r.person_employment?.latest_wage_change_date),
    },
    // — Compensation & Benefits: benefits —
    {
      key: "benefits_enrolled",
      header: "Benefits Enrolled",
      value: (r) => r.person_employment?.benefits_enrolled ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="benefits_enrolled"
          kind="checkbox"
          rawValue={r.person_employment?.benefits_enrolled ?? false}
          disabled={!editable}
        />
      ),
    },
    {
      key: "benefits_monthly",
      header: "Benefits / Month",
      value: (r) => r.person_employment?.benefits_monthly ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="benefits_monthly"
          kind="money"
          align="right"
          rawValue={r.person_employment?.benefits_monthly ?? null}
          display={moneyCell(r.person_employment?.benefits_monthly)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "benefits_annual",
      header: "Benefits / Year",
      value: (r) => r.person_employment?.benefits_annual ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="benefits_annual"
          kind="money"
          align="right"
          rawValue={r.person_employment?.benefits_annual ?? null}
          display={moneyCell(r.person_employment?.benefits_annual)}
          disabled={!editable}
        />
      ),
    },
    // — Compensation & Benefits: continuing education —
    {
      key: "ce_budget",
      header: "CE Budget",
      value: (r) => r.person_employment?.ce_budget ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="ce_budget"
          kind="money"
          align="right"
          rawValue={r.person_employment?.ce_budget ?? null}
          display={moneyCell(r.person_employment?.ce_budget)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "ce_used",
      header: "CE Used",
      value: (r) => r.person_employment?.ce_used ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="ce_used"
          kind="money"
          align="right"
          rawValue={r.person_employment?.ce_used ?? null}
          display={moneyCell(r.person_employment?.ce_used)}
          disabled={!editable}
        />
      ),
    },
    {
      key: "ce_remaining",
      header: "CE Remaining",
      value: (r) => r.person_employment?.ce_remaining ?? null,
      render: (r) => moneyCell(r.person_employment?.ce_remaining),
    },
    // — Compensation & Benefits: paid time off —
    {
      key: "pto_allotment",
      header: "PTO Allotment",
      value: (r) => r.person_employment?.pto_policy_allotment ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="pto_policy_allotment"
          kind="number"
          align="right"
          rawValue={r.person_employment?.pto_policy_allotment ?? null}
          disabled={!editable}
        />
      ),
    },
    {
      key: "pto_used",
      header: "PTO Used",
      value: (r) => r.person_employment?.pto_used ?? null,
    },
    {
      key: "pto_available",
      header: "PTO Remaining",
      value: (r) => r.person_employment?.pto_available ?? null,
    },
    {
      key: "pto_notes",
      header: "PTO Notes",
      value: (r) => r.person_employment?.pto_notes ?? null,
      render: (r) => (
        <EditableCell
          personId={r.id}
          field="pto_notes"
          kind="text"
          rawValue={r.person_employment?.pto_notes ?? null}
          disabled={!editable}
        />
      ),
    },
  ];

  const detailedEnabled = canViewAllComp && view === "detailed";
  const columns = detailedEnabled ? detailedColumns : standardColumns;

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
        onExport={() =>
          exportColumnsCsv(
            detailedEnabled ? "hr-roster-detailed" : "hr-roster",
            columns,
            rows,
          )
        }
        onImport={(f) => previewCsvImport(f, "person")}
        actions={
          <>
            {canViewAllComp ? (
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setView("standard")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    view === "standard"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setView("detailed")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    view === "detailed"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Detailed
                </button>
              </div>
            ) : null}
            {canEdit ? <NewEmployeeWizard /> : null}
          </>
        }
      />

      <StatGrid stats={stats} />

      {detailedEnabled && editable ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Click any cell to edit it inline — changes save to the employee’s
          profile automatically. Click the employee’s name to open their full
          profile.
        </p>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        filters={filters}
        initialActive={{ status: STATUS_LABELS.employee }}
        stickyScroll={detailedEnabled}
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
