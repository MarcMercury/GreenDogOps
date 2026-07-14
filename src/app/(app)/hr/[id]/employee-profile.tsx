"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type {
  RosterRow,
  PersonReview,
  PersonDisciplinaryAction,
  PersonAsset,
  PersonPtoDay,
  PersonTimeOff,
  PersonDocumentWithUrl,
  PersonRecruitingSummary,
  PersonOnboardingItem,
  PersonComplianceEntry,
  PersonLicense,
  TimeOffStatus,
} from "@/lib/hr/types";
import {
  REVIEW_TYPE_LABELS,
  VIOLATION_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  ASSET_STATUS_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  STATUS_LABELS,
  TIME_OFF_KIND_LABELS,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_STATUS_TONE,
} from "@/lib/hr/types";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  reliabilityTone,
  DAY_SHORT,
} from "@/lib/schedule/types";
import type {
  PersonAttendanceSummary,
  PersonScheduleSettings,
  PersonRoleEligibility,
} from "../../schedule/data";
import type { ProfileTransition } from "@/lib/shared/transitions";
import { transitionEventLabel, stageLabel } from "@/lib/shared/transitions";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";

/** A linked Green Dog Ops login account, surfaced read-only on the profile. */
export interface LinkedAccount {
  id: string;
  role: AppRole;
  is_active: boolean;
}
import {
  saveReview,
  deleteReview,
  saveDisciplinaryAction,
  deleteDisciplinaryAction,
  saveAsset,
  deleteAsset,
  deletePtoDay,
  saveTimeOff,
  reviewTimeOff,
  deleteTimeOff,
  uploadDocument,
  deleteDocument,
  saveOnboarding,
  addComplianceEntry,
  deleteComplianceEntry,
  saveLicense,
  deleteLicense,
  deleteEmployee,
  type SaveResult,
} from "../actions";
import { setPersonRoles, setStudentRoleFlags } from "../../schedule/actions";
import {
  EmployeeForm,
  Field,
  Select,
  Section,
  type FieldTab,
  type LocationOption,
} from "./employee-form";
import {
  ONBOARDING_GROUPS,
  COMPLIANCE_TYPES,
  LICENSES_TRACKER_LINK,
} from "@/lib/hr/onboarding";

type TabKey =
  | FieldTab
  | "onboarding"
  | "eligibility"
  | "reviews"
  | "disciplinary"
  | "documents"
  | "assets"
  | "history";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "comp", label: "Compensation & Benefits" },
  { key: "onboarding", label: "Onboarding" },
  { key: "attendance", label: "Attendance" },
  { key: "eligibility", label: "Shift Eligibility" },
  { key: "reviews", label: "Reviews" },
  { key: "disciplinary", label: "Disciplinary Action" },
  { key: "documents", label: "Documents" },
  { key: "assets", label: "Assets" },
  { key: "history", label: "History" },
];

const FIELD_TABS: TabKey[] = ["general", "comp", "attendance"];

function isFieldTab(tab: TabKey): tab is FieldTab {
  return FIELD_TABS.includes(tab);
}

export function EmployeeProfile({
  row,
  reviews,
  disciplinary,
  assets,
  documents,
  recruiting,
  transitions,
  attendance,
  scheduleSettings,
  eligibility,
  ptoDays,
  timeOff,
  onboarding,
  compliance,
  licenses,
  account,
  canViewComp,
  canEdit,
  canEditSchedule,
  isAdmin = false,
  locations,
}: {
  row: RosterRow;
  reviews: PersonReview[];
  disciplinary: PersonDisciplinaryAction[];
  assets: PersonAsset[];
  documents: PersonDocumentWithUrl[];
  recruiting: PersonRecruitingSummary | null;
  transitions: ProfileTransition[];
  attendance: PersonAttendanceSummary;
  scheduleSettings: PersonScheduleSettings;
  eligibility: PersonRoleEligibility;
  ptoDays: PersonPtoDay[];
  timeOff: PersonTimeOff[];
  onboarding: PersonOnboardingItem[];
  compliance: PersonComplianceEntry[];
  licenses: PersonLicense[];
  account: LinkedAccount | null;
  canViewComp: boolean;
  canEdit: boolean;
  canEditSchedule: boolean;
  isAdmin?: boolean;
  locations: LocationOption[];
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const tabs = canViewComp ? TABS : TABS.filter((t) => t.key !== "comp");

  const heading =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.grid_name ||
    "Employee";

  // "Used" PTO mirrors approved time-off requests; the form derives the
  // remaining balance from the allotment minus this value.
  const approvedPtoUsed = timeOff.reduce(
    (sum, t) =>
      t.status === "approved" ? sum + ptoDayCount(t.start_date, t.end_date) : sum,
    0,
  );

  // The Compensation tab's "Last review date" is driven by the Reviews tab.
  // Reviews arrive sorted by review_date desc (nulls last), so the first entry
  // with a date is the most recent review.
  const latestReviewDate =
    reviews.find((r) => r.review_date)?.review_date ?? null;

  return (
    <div className="mt-3 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {heading}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <AccountChip account={account} isAdmin={canViewComp} />
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {STATUS_LABELS[row.status] ?? row.status}
          </span>
          {isAdmin && <DeleteEmployeeButton personId={row.id} />}
        </div>
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="-mb-px flex gap-1">
          {tabs.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Field tabs stay mounted so unsaved edits survive tab switches. */}
      <EmployeeForm
        row={row}
        activeTab={isFieldTab(activeTab) ? activeTab : "general"}
        hidden={!isFieldTab(activeTab)}
        canViewComp={canViewComp}
        canEdit={canEdit}
        weeklyShiftTarget={scheduleSettings.weeklyTarget}
        approvedPtoUsed={approvedPtoUsed}
        locations={locations}
        latestReviewDate={latestReviewDate}
      />

      {activeTab === "attendance" && (
        <>
          <SchedAttendancePanel attendance={attendance} />
          <PtoPanel
            personId={row.id}
            timeOff={timeOff}
            ptoDays={ptoDays}
            canEdit={canEdit}
          />
        </>
      )}
      {activeTab === "onboarding" && (
        <OnboardingPanel
          personId={row.id}
          items={onboarding}
          compliance={compliance}
          licenses={licenses}
          canEdit={canEdit}
        />
      )}
      {activeTab === "eligibility" && (
        <>
          <EligibilityPanel
            personId={row.id}
            eligibility={eligibility}
            canEdit={canEditSchedule}
          />
          <SchedSettingsPanel settings={scheduleSettings} />
        </>
      )}
      {activeTab === "reviews" && (
        <ReviewsPanel personId={row.id} reviews={reviews} />
      )}
      {activeTab === "disciplinary" && (
        <DisciplinaryPanel
          personId={row.id}
          actions={disciplinary}
          positionTitle={
            row.person_employment?.offer_title ??
            row.person_employment?.adp_job_title ??
            null
          }
          canEdit={canEdit}
        />
      )}
      {activeTab === "documents" && (
        <DocumentsPanel personId={row.id} documents={documents} />
      )}
      {activeTab === "assets" && (
        <AssetsPanel personId={row.id} assets={assets} />
      )}
      {activeTab === "history" && (
        <HistoryPanel row={row} recruiting={recruiting} transitions={transitions} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function DeleteEmployeeButton({ personId }: { personId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            "Permanently delete this employee record and everything attached to it (employment, reviews, assets, documents, scheduling)? This cannot be undone.",
          )
        ) {
          startTransition(() => {
            void deleteEmployee(personId);
          });
        }
      }}
      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete record"}
    </button>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Inclusive number of days spanned by a time-off request (min 0). */
function ptoDayCount(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  const days = Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1;
  return days > 0 ? days : 0;
}

function AddButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function DeleteButton({
  onConfirm,
  label = "this item",
}: {
  onConfirm: () => void;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          start(() => onConfirm());
        }
      }}
      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Linked login account chip
// ---------------------------------------------------------------------------

function AccountChip({
  account,
  isAdmin,
}: {
  account: LinkedAccount | null;
  isAdmin: boolean;
}) {
  if (!account) {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
        No login account
      </span>
    );
  }

  const label = `${ROLE_LABELS[account.role]}${
    account.is_active ? "" : " · inactive"
  }`;
  const tone = account.is_active
    ? "bg-sky-100 text-sky-800"
    : "bg-slate-100 text-slate-500";

  if (!isAdmin) {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
        User · {label}
      </span>
    );
  }

  return (
    <Link
      href={`/admin/users/${account.id}`}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition hover:opacity-80 ${tone}`}
    >
      User · {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Scheduling settings (read-only mirror of Schedule → Setup → Employees)
// ---------------------------------------------------------------------------

function EligibilityPanel({
  personId,
  eligibility,
  canEdit,
}: {
  personId: string;
  eligibility: PersonRoleEligibility;
  canEdit: boolean;
}) {
  const { departments, roles } = eligibility;
  const initial = eligibility.selectedRoleIds;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial),
  );
  const [isMentor, setIsMentor] = useState(eligibility.isStudentMentor);
  const [isCoordinator, setIsCoordinator] = useState(
    eligibility.isStudentCoordinator,
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rolesDirty =
    selected.size !== initial.length ||
    initial.some((id) => !selected.has(id));
  const studentDirty =
    isMentor !== eligibility.isStudentMentor ||
    isCoordinator !== eligibility.isStudentCoordinator;
  const dirty = rolesDirty || studentDirty;

  function toggle(roleId: string) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await setPersonRoles(personId, [...selected]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const flagRes = await setStudentRoleFlags(personId, isMentor, isCoordinator);
      if (flagRes.ok) setSaved(true);
      else setError(flagRes.error);
    });
  }

  // Roles grouped under their department, departments in configured order.
  const groups = departments
    .map((d) => ({
      department: d,
      roles: roles.filter((r) => r.department_id === d.id),
    }))
    .filter((g) => g.roles.length > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Shift eligibility
        </h3>
        <Link
          href="/schedule/setup"
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          Also editable in Schedule → Setup → Roles & Eligibility
        </Link>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Check every role this employee is eligible to be scheduled for. Changes
        here update the same eligibility used across the Scheduling module, and
        edits made in Schedule → Setup show up here.
      </p>

      {groups.length === 0 ? (
        <p className="mb-5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No roles have been configured yet. Add roles in Schedule → Setup →
          Roles &amp; Eligibility first. The Student options below still apply.
        </p>
      ) : (
        <div className="mb-5 space-y-5">
          {groups.map((g) => (
            <div key={g.department.id}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {g.department.name}
              </h4>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {g.roles.map((r) => (
                  <label
                    key={r.id}
                    className={`flex items-center gap-2 text-sm ${
                      canEdit
                        ? "cursor-pointer text-slate-700"
                        : "text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      disabled={!canEdit || pending}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Student
          </h4>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <label
              className={`flex items-center gap-2 text-sm ${
                canEdit ? "cursor-pointer text-slate-700" : "text-slate-600"
              }`}
            >
              <input
                type="checkbox"
                checked={isMentor}
                disabled={!canEdit || pending}
                onChange={() => {
                  setSaved(false);
                  setIsMentor((v) => !v);
                }}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60"
              />
              Mentor
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${
                canEdit ? "cursor-pointer text-slate-700" : "text-slate-600"
              }`}
            >
              <input
                type="checkbox"
                checked={isCoordinator}
                disabled={!canEdit || pending}
                onChange={() => {
                  setSaved(false);
                  setIsCoordinator((v) => !v);
                }}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60"
              />
              Coordinator
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Not a shift — these control whether this person appears in the
            Student CRM Mentor / Coordinator dropdowns.
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save eligibility"}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
            {saved && !dirty && (
              <span className="text-sm text-emerald-700">Saved.</span>
            )}
          </div>
        )}

        {!canEdit && (
          <p className="border-t border-slate-100 pt-4 text-xs text-slate-400">
            You don’t have permission to edit scheduling. This view is
            read-only.
          </p>
        )}
      </div>
    </div>
  );
}

function SchedFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}:
      </span>
      {children}
    </span>
  );
}

function SchedSettingsPanel({
  settings,
}: {
  settings: PersonScheduleSettings;
}) {
  const {
    hasSetting,
    isSchedulable,
    weeklyTarget,
    defaultLocationName,
    eligibleLocationNames,
    availableDays,
    roleNames,
    notes,
  } = settings;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Scheduling settings
        </h3>
        <Link
          href="/schedule/setup"
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          Manage in Schedule → Setup → Employees
        </Link>
      </div>

      {!hasSetting ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No scheduling settings saved yet. Defaults apply (schedulable, any
          location, any day).
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">
          <SchedFact label="Schedulable">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                isSchedulable
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {isSchedulable ? "Yes" : "No"}
            </span>
          </SchedFact>
          <SchedFact label="Weekly target">
            <span className="text-slate-800">
              {weeklyTarget == null ? "—" : weeklyTarget}
            </span>
          </SchedFact>
          <SchedFact label="Default location">
            <span className="text-slate-800">{defaultLocationName ?? "—"}</span>
          </SchedFact>
          <SchedFact label="Roles">
            <span className="text-slate-800">
              {roleNames.length === 0 ? "None" : roleNames.join(", ")}
            </span>
          </SchedFact>
          <SchedFact label="Locations">
            <span className="text-slate-800">
              {eligibleLocationNames.length === 0
                ? "Any"
                : eligibleLocationNames.join(", ")}
            </span>
          </SchedFact>
          <SchedFact label="Days">
            <span className="text-slate-800">
              {availableDays.length === 0
                ? "Any"
                : [...availableDays]
                    .sort((a, b) => a - b)
                    .map((d) => DAY_SHORT[d])
                    .join(", ")}
            </span>
          </SchedFact>
          {notes && (
            <SchedFact label="Notes">
              <span className="whitespace-pre-wrap text-slate-800">{notes}</span>
            </SchedFact>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule attendance (read-only rollup from published schedules)
// ---------------------------------------------------------------------------

function SchedAttendancePanel({
  attendance,
}: {
  attendance: PersonAttendanceSummary;
}) {
  const { tally, score, records } = attendance;
  const [filter, setFilter] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const groups: Array<{
    key: string;
    label: string;
    value: number;
    statuses: string[];
    tone: string;
  }> = [
    {
      key: "present",
      label: "Present",
      value: tally.present,
      statuses: ["present"],
      tone: "text-emerald-600",
    },
    {
      key: "late",
      label: "Late",
      value: tally.late + tally.late_excused,
      statuses: ["late", "late_excused"],
      tone: "text-amber-600",
    },
    {
      key: "absent",
      label: "Absent",
      value: tally.absent + tally.absent_excused,
      statuses: ["absent", "absent_excused"],
      tone: "text-red-600",
    },
    {
      key: "no_show",
      label: "No-show",
      value: tally.no_show,
      statuses: ["no_show"],
      tone: "text-red-700",
    },
  ];

  const activeGroup = groups.find((g) => g.key === filter) ?? null;
  const visibleRecords = activeGroup
    ? records.filter((r) => activeGroup.statuses.includes(r.status))
    : records;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Reliability
            </p>
            <p className={`text-3xl font-bold ${reliabilityTone(score)}`}>
              {score == null ? "—" : `${score}%`}
            </p>
          </div>
          <p className="text-sm text-slate-500">
            {tally.total} resolved {tally.total === 1 ? "shift" : "shifts"} on
            published schedules
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {groups.map((g) => {
            const active = g.key === filter;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  setFilter(active ? null : g.key);
                  setShowHistory(true);
                }}
                aria-pressed={active}
                className={`rounded-lg border p-3 text-left transition hover:border-slate-300 hover:shadow-sm ${
                  active
                    ? "border-slate-400 bg-white ring-1 ring-slate-300"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {g.label}
                </p>
                <p className={`mt-1 text-2xl font-bold ${g.tone}`}>{g.value}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Click a tile to see the days it was applied.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {activeGroup ? `${activeGroup.label} days` : "Attendance history"}
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-slate-400">
              ({visibleRecords.length})
            </span>
          </span>
          <span
            className={`text-slate-400 transition-transform ${
              showHistory ? "rotate-90" : ""
            }`}
            aria-hidden
          >
            ▸
          </span>
        </button>
        {showHistory && (
          <div className="border-t border-slate-100 p-5">
            {activeGroup && (
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing {visibleRecords.length}{" "}
                  {visibleRecords.length === 1 ? "day" : "days"} marked{" "}
                  <span className="font-medium">{activeGroup.label}</span>.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter(null)}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
                >
                  Show all
                </button>
              </div>
            )}
            {visibleRecords.length === 0 ? (
              <EmptyState>
                {activeGroup
                  ? `No days marked ${activeGroup.label.toLowerCase()} yet.`
                  : "No attendance recorded yet. Marks made on a published schedule will appear here."}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visibleRecords.map((r) => (
                      <tr key={r.assignmentId} className="hover:bg-slate-50/50">
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                          {fmtDate(r.work_date)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              ATTENDANCE_TONE[r.status]
                            }`}
                          >
                            {ATTENDANCE_LABELS[r.status]}
                          </span>
                          {r.auto_absent && (
                            <span className="ml-1.5 text-xs text-slate-400">
                              auto
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {r.location_name ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {r.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PTO — unified request + log (time-off requests and logged PTO days together)
// ---------------------------------------------------------------------------

type PtoLogEntry =
  | {
      kind: "request";
      id: string;
      sortKey: string;
      label: string;
      typeLabel: string;
      note: string | null;
      status: TimeOffStatus;
    }
  | {
      kind: "logged";
      id: string;
      sortKey: string;
      label: string;
      typeLabel: string;
      note: string | null;
    };

function PtoPanel({
  personId,
  timeOff,
  ptoDays,
  canEdit,
}: {
  personId: string;
  timeOff: PersonTimeOff[];
  ptoDays: PersonPtoDay[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveTimeOff(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  const entries: PtoLogEntry[] = [
    ...timeOff.map(
      (t): PtoLogEntry => ({
        kind: "request",
        id: t.id,
        sortKey: t.start_date,
        label:
          t.start_date === t.end_date
            ? fmtDate(t.start_date)
            : `${fmtDate(t.start_date)} – ${fmtDate(t.end_date)}`,
        typeLabel: TIME_OFF_KIND_LABELS[t.kind],
        note: t.note,
        status: t.status,
      }),
    ),
    ...ptoDays.map(
      (d): PtoLogEntry => ({
        kind: "logged",
        id: d.id,
        sortKey: d.pto_date,
        label: fmtDate(d.pto_date),
        typeLabel:
          d.hours != null ? `${d.hours} hr${d.hours === 1 ? "" : "s"}` : "PTO day",
        note: d.note,
      }),
    ),
  ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

  return (
    <div className="space-y-5">
      {canEdit && (
        <Section title="PTO request">
          <form ref={formRef} action={formAction} className="contents">
            <Select
              label="Type"
              name="kind"
              defaultValue="pto"
              options={[
                { value: "pto", label: "PTO" },
                { value: "vacation", label: "Vacation" },
                { value: "time_off", label: "Time Off" },
              ]}
            />
            <Field label="From" name="start_date" type="date" />
            <Field label="To" name="end_date" type="date" />
            <Field
              label="Note"
              name="note"
              placeholder="Optional reason / details"
            />
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <AddButton>Add request</AddButton>
              {result?.ok === false && (
                <span className="text-sm text-red-600">{result.error}</span>
              )}
            </div>
          </form>
        </Section>
      )}

      <Section title={`PTO log (${entries.length})`}>
        <div className="sm:col-span-2 lg:col-span-3">
          {entries.length === 0 ? (
            <EmptyState>No PTO requested or logged yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {entries.map((e) => (
                <li
                  key={`${e.kind}-${e.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-800">
                      {e.label}
                    </span>
                    <span className="ml-2 text-xs font-medium text-slate-500">
                      {e.typeLabel}
                    </span>
                    {e.note && (
                      <span className="ml-2 text-xs text-slate-500">
                        · {e.note}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {e.kind === "request" ? (
                      <>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={e.status === "approved"}
                            disabled={!canEdit || pending}
                            onChange={(ev) => {
                              const approve = ev.target.checked;
                              start(async () => {
                                await reviewTimeOff(
                                  personId,
                                  e.id,
                                  approve ? "approved" : "requested",
                                );
                              });
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60"
                          />
                          Approved
                        </label>
                        {e.status === "denied" && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIME_OFF_STATUS_TONE.denied}`}
                          >
                            {TIME_OFF_STATUS_LABELS.denied}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        Logged
                      </span>
                    )}
                    {canEdit && (
                      <DeleteButton
                        label={
                          e.kind === "request"
                            ? "this PTO request"
                            : "this PTO day"
                        }
                        onConfirm={() =>
                          e.kind === "request"
                            ? deleteTimeOff(personId, e.id)
                            : deletePtoDay(personId, e.id)
                        }
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

function ReviewsPanel({
  personId,
  reviews,
}: {
  personId: string;
  reviews: PersonReview[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveReview(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Log a review">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Review date" name="review_date" type="date" />
          <Select
            label="Type"
            name="review_type"
            options={Object.entries(REVIEW_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Field label="Reviewer" name="reviewer" />
          <Field label="Rating / score" name="rating" placeholder="e.g. Exceeds, 4/5" />
          <Field label="Next review date" name="next_review_date" type="date" />
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-slate-500">Summary</span>
            <textarea
              name="summary"
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Add review</AddButton>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {reviews.length === 0 ? (
        <EmptyState>No reviews logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {r.review_type
                      ? (REVIEW_TYPE_LABELS[r.review_type] ?? r.review_type)
                      : "Review"}
                    {r.rating ? ` · ${r.rating}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(r.review_date)}
                    {r.reviewer ? ` · ${r.reviewer}` : ""}
                    {r.next_review_date
                      ? ` · next: ${fmtDate(r.next_review_date)}`
                      : ""}
                  </p>
                </div>
                <DeleteButton
                  label="this review"
                  onConfirm={() => deleteReview(personId, r.id)}
                />
              </div>
              {r.summary && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {r.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disciplinary actions
// ---------------------------------------------------------------------------

function DisciplinaryPanel({
  personId,
  actions,
  positionTitle,
  canEdit,
}: {
  personId: string;
  actions: PersonDisciplinaryAction[];
  positionTitle: string | null;
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveDisciplinaryAction(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <Section title="Log a disciplinary action">
          <form ref={formRef} action={formAction} className="contents">
            <Field
              label="Your name"
              name="reported_by"
              placeholder="Who is filing this write-up"
            />
            <Field
              label="Employee position"
              name="employee_position"
              defaultValue={positionTitle ?? ""}
              placeholder="e.g. MPMV Tech"
            />
            <Field label="Date of incident" name="incident_date" type="date" />
            <Select
              label="Violation of"
              name="violation_type"
              options={Object.entries(VIOLATION_TYPE_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-slate-500">
                Nature of violation
              </span>
              <textarea
                name="nature"
                rows={4}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-slate-500">
                Action taken / next steps
              </span>
              <textarea
                name="action_taken"
                rows={2}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <Field
              label="Witnesses"
              name="witnesses"
              placeholder="Comma-separated names"
            />
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <AddButton>Add disciplinary action</AddButton>
              {result?.ok === false && (
                <span className="text-sm text-red-600">{result.error}</span>
              )}
            </div>
          </form>
        </Section>
      )}

      {actions.length === 0 ? (
        <EmptyState>No disciplinary actions logged yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {a.violation_type
                      ? (VIOLATION_TYPE_LABELS[a.violation_type] ??
                        a.violation_type)
                      : "Disciplinary action"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(a.incident_date)}
                    {a.reported_by ? ` · by ${a.reported_by}` : ""}
                    {a.employee_position ? ` · ${a.employee_position}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <DeleteButton
                    label="this disciplinary action"
                    onConfirm={() => deleteDisciplinaryAction(personId, a.id)}
                  />
                )}
              </div>
              {a.nature && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {a.nature}
                </p>
              )}
              {a.action_taken && (
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-600">
                    Action taken:{" "}
                  </span>
                  {a.action_taken}
                </p>
              )}
              {a.witnesses && (
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium">Witnesses: </span>
                  {a.witnesses}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsPanel({
  personId,
  documents,
}: {
  personId: string;
  documents: PersonDocumentWithUrl[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => uploadDocument(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Upload a document">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Title" name="title" placeholder="e.g. Signed offer letter" />
          <Select
            label="Category"
            name="category"
            options={Object.entries(DOCUMENT_CATEGORY_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">File</span>
            <input
              name="file"
              type="file"
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Upload</AddButton>
            <span className="text-xs text-slate-400">Max 25 MB.</span>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {documents.length === 0 ? (
        <EmptyState>No documents uploaded yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {d.signed_url ? (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:text-emerald-900 hover:underline"
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {d.category
                    ? (DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category)
                    : "Uncategorized"}
                  {d.file_name ? ` · ${d.file_name}` : ""}
                  {d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}
                  {` · ${fmtDate(d.uploaded_at)}`}
                </p>
              </div>
              <DeleteButton
                label="this document"
                onConfirm={() => deleteDocument(personId, d.id, d.storage_path)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

type OnboardingItemState = {
  provided: boolean;
  provided_date: string;
  completed: boolean;
  completed_date: string;
  notes: string;
};

type OnboardingState = Record<string, OnboardingItemState>;

function buildOnboardingState(items: PersonOnboardingItem[]): OnboardingState {
  const byKey = new Map(items.map((i) => [i.item_key, i]));
  const state: OnboardingState = {};
  for (const def of ONBOARDING_GROUPS.flatMap((g) => g.items)) {
    const row = byKey.get(def.key);
    state[def.key] = {
      provided: row?.provided ?? false,
      provided_date: row?.provided_date ?? "",
      completed: row?.completed ?? false,
      completed_date: row?.completed_date ?? "",
      notes: row?.notes ?? "",
    };
  }
  return state;
}

function OnboardingPanel({
  personId,
  items,
  compliance,
  licenses,
  canEdit,
}: {
  personId: string;
  items: PersonOnboardingItem[];
  compliance: PersonComplianceEntry[];
  licenses: PersonLicense[];
  canEdit: boolean;
}) {
  const initial = useMemo(() => buildOnboardingState(items), [items]);
  const [state, setState] = useState<OnboardingState>(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync when the server sends fresh data (e.g. after a save revalidates).
  if (syncedFrom !== initial) {
    setSyncedFrom(initial);
    setState(initial);
  }

  const allItems = ONBOARDING_GROUPS.flatMap((g) => g.items);
  const total = allItems.length;
  const completedCount = allItems.filter(
    (i) => state[i.key]?.completed,
  ).length;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  function update(key: string, patch: Partial<OnboardingItemState>) {
    setSaved(false);
    setState((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }

  function save() {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    for (const it of allItems) {
      const v = state[it.key];
      if (v.provided) fd.set(`${it.key}__provided`, "on");
      if (v.provided && v.provided_date)
        fd.set(`${it.key}__provided_date`, v.provided_date);
      if (v.completed) fd.set(`${it.key}__completed`, "on");
      if (v.completed && v.completed_date)
        fd.set(`${it.key}__completed_date`, v.completed_date);
      if (v.notes) fd.set(`${it.key}__notes`, v.notes);
    }
    start(async () => {
      const res = await saveOnboarding(personId, null, fd);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">
              Onboarding progress
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {completedCount} of {total} items completed
            </p>
          </div>
          <span className="text-lg font-bold text-emerald-700">{pct}%</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {ONBOARDING_GROUPS.map((group) => (
        <section
          key={group.title}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {group.title}
          </h2>
          <ul className="divide-y divide-slate-100">
            {group.items.map((item) => {
              const v = state[item.key];
              return (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2"
                >
                  <div className="flex min-w-0 basis-full items-center gap-2 lg:basis-64">
                    {v.completed ? (
                      <span className="text-emerald-600">✓</span>
                    ) : v.provided ? (
                      <span className="text-amber-500">◑</span>
                    ) : (
                      <span className="text-slate-300">○</span>
                    )}
                    <span
                      className="truncate text-sm font-medium text-slate-800"
                      title={item.label}
                    >
                      {item.label}
                    </span>
                    {(item.help || item.link) && (
                      <span className="group relative shrink-0">
                        <span className="cursor-help text-xs text-slate-300 hover:text-slate-500">
                          ⓘ
                        </span>
                        <span className="pointer-events-none absolute left-0 top-full z-10 hidden w-64 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-500 shadow-lg group-hover:block">
                          {item.help}
                          {item.link && (
                            <a
                              href={item.link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pointer-events-auto mt-1 block font-medium text-emerald-700 hover:underline"
                            >
                              {item.link.label} ↗
                            </a>
                          )}
                        </span>
                      </span>
                    )}
                  </div>

                  <InlineStateControl
                    label={item.providedLabel ?? "Provided"}
                    checked={v.provided}
                    date={v.provided_date}
                    disabled={!canEdit}
                    onToggle={(checked) =>
                      update(item.key, {
                        provided: checked,
                        provided_date: checked ? v.provided_date : "",
                      })
                    }
                    onDate={(d) => update(item.key, { provided_date: d })}
                  />
                  <InlineStateControl
                    label={item.completedLabel ?? "Completed"}
                    checked={v.completed}
                    date={v.completed_date}
                    disabled={!canEdit}
                    onToggle={(checked) =>
                      update(item.key, {
                        completed: checked,
                        completed_date: checked ? v.completed_date : "",
                      })
                    }
                    onDate={(d) => update(item.key, { completed_date: d })}
                  />

                  <input
                    value={v.notes}
                    disabled={!canEdit}
                    onChange={(e) => update(item.key, { notes: e.target.value })}
                    placeholder="Notes"
                    className="min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save onboarding"}
          </button>
          {saved && <span className="text-sm text-emerald-600">Saved.</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}

      <ComplianceSection
        personId={personId}
        entries={compliance}
        canEdit={canEdit}
      />

      <LicensesSection
        personId={personId}
        licenses={licenses}
        canEdit={canEdit}
      />
    </div>
  );
}

/** Compact "checkbox + inline date" control used for checklist states. */
function InlineStateControl({
  label,
  checked,
  date,
  disabled,
  onToggle,
  onDate,
}: {
  label: string;
  checked: boolean;
  date: string;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
  onDate: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        {label}
      </label>
      <input
        type="date"
        value={date}
        disabled={disabled || !checked}
        onChange={(e) => onDate(e.target.value)}
        className="w-[8.5rem] rounded-lg border border-slate-300 px-2 py-1.5 text-xs shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
      />
    </div>
  );
}

/** Ongoing log of dated compliance entries, grouped by compliance track. */
type ComplianceTrackInfo = {
  key: string;
  label: string;
  help?: string;
  /** Custom tracks let the label be edited until the first entry is saved. */
  custom: boolean;
};

function ComplianceSection({
  personId,
  entries,
  canEdit,
}: {
  personId: string;
  entries: PersonComplianceEntry[];
  canEdit: boolean;
}) {
  // Locally-added custom tracks that have no saved entries yet.
  const [customTracks, setCustomTracks] = useState<
    { key: string; label: string }[]
  >([]);

  const entriesByKey = useMemo(() => {
    const map = new Map<string, PersonComplianceEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.compliance_key);
      if (arr) arr.push(e);
      else map.set(e.compliance_key, [e]);
    }
    return map;
  }, [entries]);

  const tracks: ComplianceTrackInfo[] = [];
  const seen = new Set<string>();
  for (const t of COMPLIANCE_TYPES) {
    tracks.push({ key: t.key, label: t.label, help: t.help, custom: false });
    seen.add(t.key);
  }
  for (const [key, arr] of entriesByKey) {
    if (!seen.has(key)) {
      tracks.push({ key, label: arr[0].label, custom: true });
      seen.add(key);
    }
  }
  for (const t of customTracks) {
    if (!seen.has(t.key)) {
      tracks.push({ key: t.key, label: t.label, custom: true });
      seen.add(t.key);
    }
  }

  // A track's label stays editable until its first entry is saved.
  const editableKeys = new Set(
    customTracks.filter((t) => !entriesByKey.has(t.key)).map((t) => t.key),
  );

  function addTrack() {
    setCustomTracks((prev) => [
      ...prev,
      { key: `custom_${Date.now()}_${prev.length}`, label: "" },
    ]);
  }

  function setTrackLabel(key: string, label: string) {
    setCustomTracks((prev) =>
      prev.map((t) => (t.key === key ? { ...t, label } : t)),
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Annual Compliance
      </h2>

      <div className="space-y-4">
        {tracks.map((track) => (
          <ComplianceTrack
            key={track.key}
            personId={personId}
            track={track}
            entries={entriesByKey.get(track.key) ?? []}
            labelEditable={editableKeys.has(track.key)}
            onLabelChange={(label) => setTrackLabel(track.key, label)}
            canEdit={canEdit}
          />
        ))}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={addTrack}
          className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
        >
          + Add Item
        </button>
      )}
    </div>
  );
}

/**
 * One compliance track: its history of completed dates plus a blank row to log
 * the next completion. Saving appends the entry and clears the row so the next
 * one can be recorded straight away.
 */
function ComplianceTrack({
  personId,
  track,
  entries,
  labelEditable,
  onLabelChange,
  canEdit,
}: {
  personId: string;
  track: ComplianceTrackInfo;
  entries: PersonComplianceEntry[];
  labelEditable: boolean;
  onLabelChange: (label: string) => void;
  canEdit: boolean;
}) {
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addEntry() {
    setError(null);
    if (labelEditable && !track.label.trim()) {
      setError("Name this compliance item first.");
      return;
    }
    if (!date) {
      setError("A completed date is required.");
      return;
    }
    const fd = new FormData();
    fd.set("compliance_key", track.key);
    fd.set("label", track.label.trim());
    fd.set("completed_date", date);
    if (notes.trim()) fd.set("notes", notes.trim());
    start(async () => {
      const res = await addComplianceEntry(personId, fd);
      if (res.ok) {
        setDate("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {labelEditable ? (
          <input
            value={track.label}
            disabled={!canEdit}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Compliance item name"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        ) : (
          <h3 className="text-sm font-semibold text-slate-800">
            {track.label}
          </h3>
        )}
        {track.help && (
          <span className="group relative shrink-0">
            <span className="cursor-help text-xs text-slate-300 hover:text-slate-500">
              ⓘ
            </span>
            <span className="pointer-events-none absolute left-0 top-full z-10 hidden w-64 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-500 shadow-lg group-hover:block">
              {track.help}
            </span>
          </span>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-800">
                  {fmtDate(e.completed_date)}
                </span>
                {e.notes && (
                  <span className="ml-2 text-xs text-slate-500">
                    · {e.notes}
                  </span>
                )}
              </div>
              {canEdit && (
                <DeleteButton
                  label={`this ${track.label || "compliance"} entry`}
                  onConfirm={() => deleteComplianceEntry(personId, e.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
            Completed
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-[8.5rem] rounded-lg border border-slate-300 px-2 py-1.5 text-xs shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className="min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={addEntry}
            disabled={pending}
            className="rounded-lg border border-emerald-600 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      ) : (
        entries.length === 0 && (
          <p className="text-xs text-slate-400">No entries recorded.</p>
        )
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Licenses & Expiration Dates (editable, renewable list)
// ---------------------------------------------------------------------------

function LicensesSection({
  personId,
  licenses,
  canEdit,
}: {
  personId: string;
  licenses: PersonLicense[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveLicense(personId, null, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Licenses &amp; Expiration Dates
        </h2>
        <a
          href={LICENSES_TRACKER_LINK.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          {LICENSES_TRACKER_LINK.label} ↗
        </a>
      </div>

      {canEdit && (
        <Section title="Add a license">
          <form ref={formRef} action={formAction} className="contents">
            <Field label="License" name="name" placeholder="e.g. DVM License" />
            <Field label="License #" name="license_number" />
            <Field
              label="Issuing authority"
              name="issuing_authority"
              placeholder="e.g. CA Veterinary Medical Board"
            />
            <Field label="Issued" name="issued_date" type="date" />
            <Field label="Expires" name="expiration_date" type="date" />
            <Field label="Notes" name="notes" />
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
              <AddButton>Add license</AddButton>
              {result?.ok === false && (
                <span className="text-sm text-red-600">{result.error}</span>
              )}
            </div>
          </form>
        </Section>
      )}

      <Section title={`Licenses (${licenses.length})`}>
        <div className="sm:col-span-2 lg:col-span-3">
          {licenses.length === 0 ? (
            <EmptyState>No licenses recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {licenses.map((lic) => (
                <LicenseRow
                  key={lic.id}
                  personId={personId}
                  license={lic}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}

/** Expiration status tone: red when expired, amber within 60 days. */
function expirationTone(expiration: string | null): {
  label: string;
  className: string;
} | null {
  if (!expiration) return null;
  const exp = new Date(`${expiration}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  const days = Math.round((exp.getTime() - now.getTime()) / 86_400_000);
  if (days < 0)
    return { label: "Expired", className: "bg-red-100 text-red-700" };
  if (days <= 60)
    return {
      label: `Expires in ${days}d`,
      className: "bg-amber-100 text-amber-700",
    };
  return null;
}

function LicenseRow({
  personId,
  license,
  canEdit,
}: {
  personId: string;
  license: PersonLicense;
  canEdit: boolean;
}) {
  const [issued, setIssued] = useState(license.issued_date ?? "");
  const [expires, setExpires] = useState(license.expiration_date ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    issued !== (license.issued_date ?? "") ||
    expires !== (license.expiration_date ?? "");

  const tone = expirationTone(license.expiration_date);

  function saveDates() {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("name", license.name);
    if (license.license_number) fd.set("license_number", license.license_number);
    if (license.issuing_authority)
      fd.set("issuing_authority", license.issuing_authority);
    if (issued) fd.set("issued_date", issued);
    if (expires) fd.set("expiration_date", expires);
    if (license.notes) fd.set("notes", license.notes);
    start(async () => {
      const res = await saveLicense(personId, license.id, fd);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex min-w-0 basis-full items-center gap-2 lg:basis-56">
        <span className="truncate text-sm font-medium text-slate-800">
          {license.name}
        </span>
        {tone && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}
          >
            {tone.label}
          </span>
        )}
      </div>
      <div className="min-w-0 text-xs text-slate-500">
        {license.license_number && (
          <span className="mr-3">#{license.license_number}</span>
        )}
        {license.issuing_authority && <span>{license.issuing_authority}</span>}
      </div>
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
        Issued
        <input
          type="date"
          value={issued}
          disabled={!canEdit}
          onChange={(e) => {
            setSaved(false);
            setIssued(e.target.value);
          }}
          className="w-[8.5rem] rounded-lg border border-slate-300 px-2 py-1.5 text-xs shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
        />
      </label>
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-600">
        Expires
        <input
          type="date"
          value={expires}
          disabled={!canEdit}
          onChange={(e) => {
            setSaved(false);
            setExpires(e.target.value);
          }}
          className="w-[8.5rem] rounded-lg border border-slate-300 px-2 py-1.5 text-xs shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
        />
      </label>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveDates}
            disabled={!dirty || pending}
            className="rounded-lg border border-emerald-600 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Update"}
          </button>
          {saved && !dirty && (
            <span className="text-xs text-emerald-600">Saved.</span>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <DeleteButton
            label={`the ${license.name} license`}
            onConfirm={() => deleteLicense(personId, license.id)}
          />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function AssetsPanel({
  personId,
  assets,
}: {
  personId: string;
  assets: PersonAsset[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, formAction] = useActionState<SaveResult | null, FormData>(
    (prev, fd) => saveAsset(personId, prev, fd),
    null,
  );

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-5">
      <Section title="Assign an asset">
        <form ref={formRef} action={formAction} className="contents">
          <Field label="Asset name" name="asset_name" placeholder="e.g. MacBook Air" />
          <Select
            label="Type"
            name="asset_type"
            options={Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Field label="Serial / tag" name="identifier" />
          <Field label="Assigned date" name="assigned_date" type="date" />
          <Field label="Returned date" name="returned_date" type="date" />
          <Select
            label="Status"
            name="status"
            defaultValue="assigned"
            options={Object.entries(ASSET_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-slate-500">Notes</span>
            <textarea
              name="notes"
              rows={2}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <AddButton>Add asset</AddButton>
            {result?.ok === false && (
              <span className="text-sm text-red-600">{result.error}</span>
            )}
          </div>
        </form>
      </Section>

      {assets.length === 0 ? (
        <EmptyState>No assets assigned yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {assets.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {a.asset_name}
                    {a.asset_type
                      ? ` · ${ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}`
                      : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.identifier ? `#${a.identifier} · ` : ""}
                    {`Assigned ${fmtDate(a.assigned_date)}`}
                    {a.returned_date ? ` · Returned ${fmtDate(a.returned_date)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {ASSET_STATUS_LABELS[a.status] ?? a.status}
                  </span>
                  <DeleteButton
                    label="this asset"
                    onConfirm={() => deleteAsset(personId, a.id)}
                  />
                </div>
              </div>
              {a.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {a.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (read-only recruiting summary, carried over from the ATS record)
// ---------------------------------------------------------------------------

function HistoryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function HistoryPanel({
  row,
  recruiting,
  transitions,
}: {
  row: RosterRow;
  recruiting: PersonRecruitingSummary | null;
  transitions: ProfileTransition[];
}) {
  const emp = row.person_employment;

  return (
    <div className="space-y-5">
      <Section title="Stage movement">
        {transitions.length === 0 ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState>No stage movements recorded yet.</EmptyState>
          </div>
        ) : (
          <ol className="space-y-3 sm:col-span-2 lg:col-span-3">
            {transitions.map((t) => {
              const from = stageLabel(t.from_stage);
              const to = stageLabel(t.to_stage);
              return (
                <li
                  key={t.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {transitionEventLabel(t.event_type)}
                    </p>
                    <span className="text-xs text-slate-500">
                      {fmtDate(t.created_at)}
                    </span>
                  </div>
                  {(from || to) && (
                    <p className="mt-1 text-xs text-slate-500">
                      {from ?? "\u2014"}
                      {" \u2192 "}
                      {to ?? "\u2014"}
                    </p>
                  )}
                  {t.detail && (
                    <p className="mt-1 text-sm text-slate-700">{t.detail}</p>
                  )}
                  {t.actor_name && (
                    <p className="mt-1 text-xs text-slate-400">by {t.actor_name}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section title="Employment timeline">
        <dl className="sm:col-span-2 lg:col-span-3">
          <HistoryRow label="Current status" value={STATUS_LABELS[row.status] ?? row.status} />
          <HistoryRow label="Original hire date" value={fmtDate(emp?.original_hire_date ?? null)} />
          <HistoryRow label="Hire date" value={fmtDate(emp?.hire_date ?? null)} />
          <HistoryRow label="Separation date" value={fmtDate(emp?.separation_date ?? null)} />
          <HistoryRow label="Record created" value={fmtDate(row.created_at)} />
        </dl>
      </Section>

      <Section title="Recruiting history">
        {recruiting ? (
          <dl className="sm:col-span-2 lg:col-span-3">
            <HistoryRow label="Pipeline" value={recruiting.pipeline} />
            <HistoryRow label="Final stage" value={recruiting.stage} />
            <HistoryRow label="Source" value={recruiting.source} />
            <HistoryRow label="Interview date" value={fmtDate(recruiting.interview_date)} />
            <HistoryRow
              label="Score"
              value={recruiting.score != null ? String(recruiting.score) : null}
            />
            <HistoryRow
              label="Resume"
              value={
                recruiting.resume_url ? (
                  <a
                    href={recruiting.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 hover:underline"
                  >
                    View resume
                  </a>
                ) : null
              }
            />
            <HistoryRow label="Status notes" value={recruiting.status_notes} />
            <HistoryRow label="Recruiter notes" value={recruiting.notes} />
          </dl>
        ) : (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState>
              No recruiting record found for this person. History is captured
              automatically when an applicant/candidate is converted to an employee.
            </EmptyState>
          </div>
        )}
      </Section>
    </div>
  );
}
