// ADP RUN "Time Sheet Import" file (owner process step 3: EXPORT ADP REPORT).
//
// Layout — the ADP pay-data import used by RUN's Home ▸ Time Sheet Import
// (verified against integration guides: Redcort Virtual TimeClock "Exporting
// to ADP Run", Kloqk "ADP Timesheet CSV column reference"; see
// docs/agent/integrations.md):
//
//   Co Code, Batch ID, File #, Reg Hours, O/T Hours, Hours 3 Code, Hours 3 Amount
//
// One row per employee carries Reg and O/T hours; every other kind of hours
// (double time, meal premium, PTO) is an extra row for the same
// File # with an earnings code from the company's RUN earnings list and the
// hours. Codes and File #s must match RUN exactly or the hours are dropped.
// Batch ID = the pay date as YYMMDD, so re-exporting a period produces the same
// batch and RUN can flag a duplicate import. Hours: 2 decimals, blank when 0.
// Prerequisite in RUN: Settings ▸ General Settings ▸ Features and Services ▸
// Payroll Features ▸ "Time Sheet Import" enabled.

import type { ReviewedLine } from "./review";

export const ADP_RUN_FORMAT = "adp_run_timesheet_v1";
export const ADP_RUN_HEADER = ["Co Code", "Batch ID", "File #", "Reg Hours", "O/T Hours", "Hours 3 Code", "Hours 3 Amount"] as const;

/** Hours buckets that need a RUN earnings code (regular and overtime have their own columns). */
export const CODED_FIELDS = ["double_time", "meal_premium", "pto"] as const;
export type CodedField = (typeof CODED_FIELDS)[number];

export const ADP_SETTING_KEYS = {
  companyCode: "payroll.adp.company_code",
  codes: {
    double_time: "payroll.adp.code.double_time",
    meal_premium: "payroll.adp.code.meal_premium",
    pto: "payroll.adp.code.pto",
  } satisfies Record<CodedField, string>,
} as const;

export interface AdpSettings {
  companyCode: string;
  codes: Record<CodedField, string>;
}

const clean = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Read the settings rows (values may be strings, numbers or null). */
export function adpSettingsFrom(values: ReadonlyMap<string, unknown>): AdpSettings {
  return {
    companyCode: clean(values.get(ADP_SETTING_KEYS.companyCode)),
    codes: {
      double_time: clean(values.get(ADP_SETTING_KEYS.codes.double_time)),
      meal_premium: clean(values.get(ADP_SETTING_KEYS.codes.meal_premium)),
      pto: clean(values.get(ADP_SETTING_KEYS.codes.pto)),
    },
  };
}

export const CODED_LABELS: Record<CodedField, string> = {
  double_time: "double time",
  meal_premium: "meal premium",
  pto: "PTO",
};

/** What stops the RUN file from being built (empty = ready). */
export function adpExportBlockers(lines: readonly ReviewedLine[], s: AdpSettings): string[] {
  const out: string[] = [];
  if (!s.companyCode) out.push("Enter the ADP RUN company code in Admin ▸ Settings ▸ Payroll.");
  else if (!/^[A-Za-z0-9]{1,10}$/.test(s.companyCode)) out.push("The ADP RUN company code should be letters and digits only.");
  for (const f of CODED_FIELDS) {
    if (!s.codes[f] && lines.some((l) => l.hours[f] > 0)) {
      out.push(`Enter the RUN earnings code for ${CODED_LABELS[f]} in Admin ▸ Settings ▸ Payroll (this period has ${CODED_LABELS[f]} hours).`);
    }
  }
  const noId = lines.filter((l) => !l.adp_employee_id);
  if (noId.length) out.push(`${noId.length} employee(s) in the review have no ADP RUN Employee ID.`);
  return out;
}

/** Batch ID: the pay date as YYMMDD. */
export function batchIdFor(payDate: string): string {
  return payDate.slice(2, 4) + payDate.slice(5, 7) + payDate.slice(8, 10);
}

const amt = (n: number) => (n ? (Math.round(n * 100) / 100).toFixed(2) : "");

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The RUN Time Sheet Import CSV (CRLF, header row first). */
export function adpRunCsv(lines: readonly ReviewedLine[], s: AdpSettings, payDate: string): string {
  const batch = batchIdFor(payDate);
  const rows: string[][] = [[...ADP_RUN_HEADER]];
  const sorted = [...lines].sort((a, b) => String(a.adp_employee_id).localeCompare(String(b.adp_employee_id), "en", { numeric: true }));
  for (const l of sorted) {
    const id = l.adp_employee_id ?? "";
    if (l.hours.regular || l.hours.overtime) {
      rows.push([s.companyCode, batch, id, amt(l.hours.regular), amt(l.hours.overtime), "", ""]);
    }
    for (const f of CODED_FIELDS) {
      if (l.hours[f]) rows.push([s.companyCode, batch, id, "", "", s.codes[f], amt(l.hours[f])]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const NAME_HEADER = [
  "ADP RUN Employee ID",
  "Employee",
  "FLSA",
  "Regular",
  "Overtime 1.5x",
  "Double time 2x",
  "Meal premium",
  "PTO",
];

/** Human-readable companion (names included) for Payroll to check RUN's import preview against. */
export function reviewSummaryCsv(lines: readonly ReviewedLine[], periodStart: string, periodEnd: string): string {
  const rows: string[][] = [[`Pay period ${periodStart} – ${periodEnd}`], NAME_HEADER];
  for (const l of [...lines].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push([
      l.adp_employee_id ?? "",
      l.name,
      l.flsa === "exempt" ? "Exempt" : l.flsa === "non_exempt" ? "Non-exempt" : "Unknown",
      amt(l.hours.regular) || "0.00",
      amt(l.hours.overtime) || "0.00",
      amt(l.hours.double_time) || "0.00",
      amt(l.hours.meal_premium) || "0.00",
      amt(l.hours.pto) || "0.00",
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
