"use client";

import { useState } from "react";
import type {
  RosterRow,
  PersonReview,
  PersonDisciplinaryAction,
  PersonAsset,
  PersonPtoDay,
  PersonTimeOff,
  PersonDocumentWithUrl,
  PersonOnboardingItem,
  PersonComplianceEntry,
  PersonLicense,
} from "@/lib/hr/types";
import {
  REVIEW_TYPE_LABELS,
  VIOLATION_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  ASSET_STATUS_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  STATUS_LABELS,
  PAY_TYPE_LABELS,
  WORK_LOCATION_LABELS,
  SCHEDULE_LABELS,
  TIME_OFF_KIND_LABELS,
  TIME_OFF_STATUS_LABELS,
} from "@/lib/hr/types";
import { ATTENDANCE_LABELS, DAY_SHORT } from "@/lib/schedule/types";
import { ONBOARDING_GROUPS } from "@/lib/hr/onboarding";
import type {
  PersonAttendanceSummary,
  PersonScheduleSettings,
  PersonRoleEligibility,
} from "../../schedule/data";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";

/** Everything the printable summary needs. Mirrors the profile's props. */
export interface EmployeeSummaryData {
  row: RosterRow;
  canViewComp: boolean;
  reviews: PersonReview[];
  disciplinary: PersonDisciplinaryAction[];
  assets: PersonAsset[];
  documents: PersonDocumentWithUrl[];
  attendance: PersonAttendanceSummary;
  scheduleSettings: PersonScheduleSettings;
  eligibility: PersonRoleEligibility;
  ptoDays: PersonPtoDay[];
  timeOff: PersonTimeOff[];
  onboarding: PersonOnboardingItem[];
  compliance: PersonComplianceEntry[];
  licenses: PersonLicense[];
  account: { role: AppRole; is_active: boolean } | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers (kept self-contained so the summary is portable)
// ---------------------------------------------------------------------------

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function num(n: number | null | undefined): string {
  return n == null ? "—" : String(n);
}

function text(s: string | null | undefined): string {
  return s && String(s).trim() ? esc(s) : "—";
}

function yesNo(b: boolean | null | undefined): string {
  if (b == null) return "—";
  return b ? "Yes" : "No";
}

/** Render a two-column definition list from [label, value] rows. */
function dl(rows: Array<[string, string]>): string {
  return `<dl class="grid">${rows
    .map(
      ([k, v]) =>
        `<div class="row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`,
    )
    .join("")}</dl>`;
}

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

function emptyNote(msg: string): string {
  return `<p class="empty">${esc(msg)}</p>`;
}

// ---------------------------------------------------------------------------
// Summary HTML builder
// ---------------------------------------------------------------------------

function buildSummaryHtml(data: EmployeeSummaryData): string {
  const {
    row,
    canViewComp,
    reviews,
    disciplinary,
    assets,
    documents,
    attendance,
    scheduleSettings,
    eligibility,
    ptoDays,
    timeOff,
    onboarding,
    compliance,
    licenses,
    account,
  } = data;

  const emp = row.person_employment;
  const name =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.grid_name ||
    "Employee";

  const jobTitle = emp?.offer_title || emp?.adp_job_title || null;

  // --- Basic Information ------------------------------------------------
  const basic = dl([
    ["Full name", text(name)],
    ["Preferred / grid name", text(row.grid_name)],
    ["Status", text(STATUS_LABELS[row.status] ?? row.status)],
    ["Job title", text(jobTitle)],
    ["ADP job title", text(emp?.adp_job_title)],
    [
      "Work location",
      text(
        row.work_location_type
          ? WORK_LOCATION_LABELS[row.work_location_type]
          : null,
      ),
    ],
    ["Preferred clinic", text(scheduleSettings.defaultLocationName)],
    ["Hire date", fmtDate(emp?.hire_date)],
    ["Original hire date", fmtDate(emp?.original_hire_date)],
    ["Email", text(row.email)],
    ["Mobile phone", text(row.phone_mobile)],
    ["Home phone", text(row.phone_home)],
    ["Other phone", text(row.phone_other)],
    ["Date of birth", fmtDate(row.date_of_birth)],
    ["Postal code", text(row.postal_code)],
    [
      "Login account",
      account
        ? `${esc(ROLE_LABELS[account.role] ?? account.role)}${
            account.is_active ? "" : " (inactive)"
          }`
        : "None",
    ],
  ]);

  // --- Compensation & Benefits (comp viewers only) ----------------------
  let compBody = emptyNote(
    "Compensation details are hidden for your access level.",
  );
  if (canViewComp) {
    const rateLabel =
      emp?.pay_type === "hourly"
        ? `${money(emp?.current_rate)}/hr`
        : money(emp?.current_rate);
    compBody = dl([
      ["Pay type", text(emp?.pay_type ? PAY_TYPE_LABELS[emp.pay_type] : null)],
      ["Current rate", emp?.current_rate == null ? "—" : rateLabel],
      ["Previous rate", money(emp?.previous_rate)],
      ["Last wage change", fmtDate(emp?.latest_wage_change_date)],
      ["Biweekly wage", money(emp?.biweekly_wage)],
      ["Annual wages", money(emp?.annual_wages)],
      ["Benefits enrolled", yesNo(emp?.benefits_enrolled)],
      ["Benefits (monthly)", money(emp?.benefits_monthly)],
      ["Benefits (annual)", money(emp?.benefits_annual)],
      ["CE budget", money(emp?.ce_budget)],
      ["CE used", money(emp?.ce_used)],
      ["CE remaining", money(emp?.ce_remaining)],
      ["PTO allotment", text(emp?.pto_allotment)],
      [
        "PTO policy (days)",
        emp?.pto_policy_allotment == null
          ? "—"
          : String(emp.pto_policy_allotment),
      ],
      ["PTO used", num(emp?.pto_used)],
      ["PTO available", num(emp?.pto_available)],
      ["PTO notes", text(emp?.pto_notes)],
      ["Last review date", fmtDate(emp?.last_review_date)],
    ]);
  }

  // --- Schedule & Eligibility -------------------------------------------
  const roleNameById = new Map(eligibility.roles.map((r) => [r.id, r.name]));
  const eligibleRoles = eligibility.selectedRoleIds
    .map((id) => roleNameById.get(id))
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));
  const availableDays =
    scheduleSettings.availableDays.length > 0
      ? scheduleSettings.availableDays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => DAY_SHORT[d] ?? String(d))
          .join(", ")
      : "Any day";

  const scheduleBody = dl([
    [
      "Work schedule",
      text(emp?.work_schedule ? SCHEDULE_LABELS[emp.work_schedule] : null),
    ],
    ["Schedule pattern", text(emp?.schedule_type)],
    ["Days per week", num(emp?.days_per_week)],
    ["Weekly shift target", num(scheduleSettings.weeklyTarget)],
    ["Schedulable", yesNo(scheduleSettings.isSchedulable)],
    ["Default location", text(scheduleSettings.defaultLocationName)],
    [
      "Eligible locations",
      scheduleSettings.eligibleLocationNames.length > 0
        ? esc(scheduleSettings.eligibleLocationNames.join(", "))
        : "Any location",
    ],
    ["Available days", esc(availableDays)],
    [
      "Shift roles",
      eligibleRoles.length > 0 ? esc(eligibleRoles.join(", ")) : "—",
    ],
    ["Scheduling notes", text(scheduleSettings.notes)],
  ]);

  // --- Attendance & Reliability -----------------------------------------
  const t = attendance.tally;
  const attendanceBody = `${dl([
    [
      "Reliability score",
      attendance.score == null ? "—" : `${attendance.score}%`,
    ],
    ["Resolved shifts", String(t.total)],
    ["Present", String(t.present)],
    ["Late", String(t.late)],
    ["Late (excused)", String(t.late_excused)],
    ["Absent", String(t.absent)],
    ["Absent (excused)", String(t.absent_excused)],
    ["No show", String(t.no_show)],
    ["PTO", String(t.pto)],
  ])}${
    attendance.records.length > 0
      ? `<table><thead><tr><th>Date</th><th>Status</th><th>Location</th><th>Note</th></tr></thead><tbody>${attendance.records
          .slice(0, 40)
          .map(
            (r) =>
              `<tr><td>${fmtDate(r.work_date)}</td><td>${esc(
                ATTENDANCE_LABELS[r.status] ?? r.status,
              )}</td><td>${text(r.location_name)}</td><td>${text(
                r.note,
              )}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No resolved attendance records.")
  }`;

  // --- Time off ----------------------------------------------------------
  const timeOffBody =
    timeOff.length > 0
      ? `<table><thead><tr><th>Type</th><th>Status</th><th>Start</th><th>End</th><th>Note</th></tr></thead><tbody>${timeOff
          .map(
            (r) =>
              `<tr><td>${esc(
                TIME_OFF_KIND_LABELS[r.kind] ?? r.kind,
              )}</td><td>${esc(
                TIME_OFF_STATUS_LABELS[r.status] ?? r.status,
              )}</td><td>${fmtDate(r.start_date)}</td><td>${fmtDate(
                r.end_date,
              )}</td><td>${text(r.note)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No time-off requests logged.");

  const ptoDaysBody =
    ptoDays.length > 0
      ? `<table><thead><tr><th>Date</th><th>Hours</th><th>Note</th></tr></thead><tbody>${ptoDays
          .map(
            (d) =>
              `<tr><td>${fmtDate(d.pto_date)}</td><td>${num(
                d.hours,
              )}</td><td>${text(d.note)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : "";

  // --- Reviews -----------------------------------------------------------
  const reviewsBody =
    reviews.length > 0
      ? `<table><thead><tr><th>Date</th><th>Type</th><th>Reviewer</th><th>Rating</th><th>Summary</th></tr></thead><tbody>${reviews
          .map(
            (r) =>
              `<tr><td>${fmtDate(r.review_date)}</td><td>${esc(
                r.review_type
                  ? REVIEW_TYPE_LABELS[r.review_type] ?? r.review_type
                  : "—",
              )}</td><td>${text(r.reviewer)}</td><td>${text(
                r.rating,
              )}</td><td>${text(r.summary)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No performance reviews recorded.");

  // --- Disciplinary ------------------------------------------------------
  const disciplinaryBody =
    disciplinary.length > 0
      ? `<table><thead><tr><th>Date</th><th>Type</th><th>Reported by</th><th>Nature</th><th>Action taken</th></tr></thead><tbody>${disciplinary
          .map(
            (d) =>
              `<tr><td>${fmtDate(d.incident_date)}</td><td>${esc(
                d.violation_type
                  ? VIOLATION_TYPE_LABELS[d.violation_type] ?? d.violation_type
                  : "—",
              )}</td><td>${text(d.reported_by)}</td><td>${text(
                d.nature,
              )}</td><td>${text(d.action_taken)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No disciplinary actions recorded.");

  // --- Licenses & Credentials -------------------------------------------
  const licensesBody =
    licenses.length > 0
      ? `<table><thead><tr><th>Credential</th><th>Number</th><th>Authority</th><th>Issued</th><th>Expires</th></tr></thead><tbody>${licenses
          .map(
            (l) =>
              `<tr><td>${text(l.name)}</td><td>${text(
                l.license_number,
              )}</td><td>${text(l.issuing_authority)}</td><td>${fmtDate(
                l.issued_date,
              )}</td><td>${fmtDate(l.expiration_date)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No licenses or credentials on file.");

  // --- Onboarding --------------------------------------------------------
  const onboardingByKey = new Map(onboarding.map((i) => [i.item_key, i]));
  const onboardingRows = ONBOARDING_GROUPS.flatMap((g) =>
    g.items.map((def) => {
      const st = onboardingByKey.get(def.key);
      const status = st?.completed
        ? `Completed${st.completed_date ? ` · ${fmtDate(st.completed_date)}` : ""}`
        : st?.provided
          ? `Sent${st.provided_date ? ` · ${fmtDate(st.provided_date)}` : ""}`
          : "Not started";
      return `<tr><td>${esc(g.title)}</td><td>${esc(def.label)}</td><td>${esc(
        status,
      )}</td></tr>`;
    }),
  ).join("");
  const onboardingBody = `<table><thead><tr><th>Group</th><th>Item</th><th>Status</th></tr></thead><tbody>${onboardingRows}</tbody></table>`;

  // --- Compliance --------------------------------------------------------
  const complianceBody =
    compliance.length > 0
      ? `<table><thead><tr><th>Track</th><th>Completed</th><th>Notes</th></tr></thead><tbody>${compliance
          .map(
            (c) =>
              `<tr><td>${text(c.label)}</td><td>${fmtDate(
                c.completed_date,
              )}</td><td>${text(c.notes)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No compliance entries logged.");

  // --- Assets ------------------------------------------------------------
  const assetsBody =
    assets.length > 0
      ? `<table><thead><tr><th>Asset</th><th>Type</th><th>Identifier</th><th>Assigned</th><th>Status</th></tr></thead><tbody>${assets
          .map(
            (a) =>
              `<tr><td>${text(a.asset_name)}</td><td>${esc(
                a.asset_type
                  ? ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type
                  : "—",
              )}</td><td>${text(a.identifier)}</td><td>${fmtDate(
                a.assigned_date,
              )}</td><td>${esc(
                ASSET_STATUS_LABELS[a.status] ?? a.status,
              )}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No assets assigned.");

  // --- Documents ---------------------------------------------------------
  const documentsBody =
    documents.length > 0
      ? `<table><thead><tr><th>Title</th><th>Category</th><th>Uploaded</th></tr></thead><tbody>${documents
          .map(
            (d) =>
              `<tr><td>${text(d.title)}</td><td>${esc(
                d.category
                  ? DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category
                  : "—",
              )}</td><td>${fmtDate(d.uploaded_at)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : emptyNote("No documents on file.");

  // --- Notes -------------------------------------------------------------
  const notesBody = row.notes
    ? `<p class="notes">${esc(row.notes)}</p>`
    : emptyNote("No notes.");

  const generatedAt = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const sections = [
    section("Basic Information", basic),
    section("Compensation & Benefits", compBody),
    section("Schedule & Eligibility", scheduleBody),
    section("Attendance & Reliability", attendanceBody),
    section(
      "Time Off",
      `${timeOffBody}${ptoDaysBody ? `<h3>Logged PTO days</h3>${ptoDaysBody}` : ""}`,
    ),
    section("Performance Reviews", reviewsBody),
    section("Disciplinary Actions", disciplinaryBody),
    section("Licenses & Credentials", licensesBody),
    section("Onboarding Checklist", onboardingBody),
    section("Annual Compliance", complianceBody),
    section("Assets", assetsBody),
    section("Documents", documentsBody),
    section("HR Notes", notesBody),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Employee Summary — ${esc(name)}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    font-size: 12px;
    line-height: 1.45;
    padding: 0.5in;
    max-width: 8.5in;
    margin: 0 auto;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  header.doc {
    border-bottom: 3px solid #059669;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  header.doc h1 { margin: 0; font-size: 22px; color: #065f46; }
  header.doc .meta { margin-top: 4px; color: #64748b; font-size: 11px; }
  header.doc .sub { margin-top: 6px; font-size: 13px; color: #334155; font-weight: 600; }
  section { margin-bottom: 18px; break-inside: avoid; }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #047857;
    border-bottom: 1px solid #d1fae5;
    padding-bottom: 4px;
    margin: 0 0 8px;
  }
  h3 { font-size: 12px; color: #334155; margin: 12px 0 6px; }
  dl.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 0; }
  dl.grid .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dotted #e2e8f0; min-width: 0; }
  dl.grid dt { color: #64748b; flex-shrink: 0; }
  dl.grid dd { margin: 0; text-align: right; font-weight: 500; color: #1e293b; min-width: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
  th { background: #f0fdf4; color: #047857; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  .empty { color: #94a3b8; font-style: italic; margin: 4px 0; }
  .notes { white-space: pre-wrap; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; overflow-wrap: anywhere; }
  footer.doc { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; color: #94a3b8; font-size: 10px; }
  @media print {
    body { padding: 0; max-width: none; }
    section { break-inside: avoid; }
  }
</style>
</head>
<body>
  <header class="doc">
    <h1>Employee Profile Summary</h1>
    <div class="sub">${esc(name)}${jobTitle ? ` — ${esc(jobTitle)}` : ""}</div>
    <div class="meta">Green Dog Ops · Generated ${esc(generatedAt)}</div>
  </header>
  ${sections}
  <footer class="doc">Confidential — for internal HR use only. Generated by Green Dog Ops.</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function DownloadSummaryButton({ data }: { data: EmployeeSummaryData }) {
  const [busy, setBusy] = useState(false);

  function handleDownload() {
    setBusy(true);
    try {
      const html = buildSummaryHtml(data);
      const win = window.open("", "_blank", "width=900,height=1000");
      if (!win) {
        alert(
          "Pop-up blocked. Please allow pop-ups for this site to download the summary.",
        );
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      // Give the new document a tick to lay out before invoking print.
      win.focus();
      win.addEventListener("load", () => {
        win.print();
      });
      // Fallback in case the load event already fired.
      setTimeout(() => {
        try {
          win.print();
        } catch {
          /* ignore */
        }
      }, 400);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={busy}
      className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50"
    >
      {busy ? "Preparing…" : "Download Employee Summary"}
    </button>
  );
}
