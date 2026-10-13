// Payroll readiness (go-live plan D12, checklist items 3, 17, 18, 25) — pure.
// Incomplete data never blocks a save; it is listed so HR can finish it before
// Ops becomes the payroll source.

export const ADP_EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

export type AdpIdValidation = { ok: true; value: string | null } | { ok: false; error: string };

/** Trimmed ADP RUN Employee ID, null when blank. Mirrors the 0244 CHECK constraint. */
export function normalizeAdpEmployeeId(raw: unknown): AdpIdValidation {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: true, value: null };
  if (!ADP_EMPLOYEE_ID_PATTERN.test(text)) {
    return { ok: false, error: "ADP RUN Employee ID can only contain letters, numbers and dashes (up to 20)." };
  }
  return { ok: true, value: text };
}

export type ReadinessItem = "email" | "flsa_status" | "hire_date" | "adp_employee_id";

export const READINESS_LABELS: Record<ReadinessItem, string> = {
  email: "Email (needed to sign in)",
  flsa_status: "FLSA status (exempt / non-exempt)",
  hire_date: "Hire date",
  adp_employee_id: "ADP RUN Employee ID",
};

export interface ReadinessInput {
  status: string;
  is_active: boolean;
  email: string | null;
  person_employment: {
    flsa_status: string | null;
    hire_date: string | null;
    adp_employee_id?: string | null;
  } | null;
}

/** Only active employees and contractors are paid through Ops. */
export function needsPayrollData(p: Pick<ReadinessInput, "status" | "is_active">): boolean {
  return p.is_active && (p.status === "employee" || p.status === "contractor");
}

/** What's missing for payroll, in display order (empty = ready or not on payroll). */
export function missingForPayroll(p: ReadinessInput): ReadinessItem[] {
  if (!needsPayrollData(p)) return [];
  const emp = p.person_employment;
  const missing: ReadinessItem[] = [];
  if (!p.email?.trim()) missing.push("email");
  if (!emp?.flsa_status) missing.push("flsa_status");
  if (!emp?.hire_date) missing.push("hire_date");
  if (!emp?.adp_employee_id?.trim()) missing.push("adp_employee_id");
  return missing;
}

/** How many people are missing each item. */
export function readinessCounts(rows: readonly ReadinessInput[]): Record<ReadinessItem, number> & { people: number; ready: number } {
  const out = { email: 0, flsa_status: 0, hire_date: 0, adp_employee_id: 0, people: 0, ready: 0 };
  for (const r of rows) {
    if (!needsPayrollData(r)) continue;
    out.people += 1;
    const m = missingForPayroll(r);
    if (m.length === 0) out.ready += 1;
    for (const item of m) out[item] += 1;
  }
  return out;
}
