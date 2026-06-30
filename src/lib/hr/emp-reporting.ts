// Payroll analytics for the Biz Dev > Emp Reporting page.
//
// Pure, DB-free helpers so they can run on the server when rendering the page
// and be unit-tested in isolation. The roster's job titles are free text and
// inconsistent (e.g. "DVM", "Doctor of Veterinary Medicine", "Relief Vet" all
// mean the same thing), so everything here works by normalizing those strings.
//
// Rules driven by the report's requirements:
//   - Executives are excluded from the report entirely.
//   - Doctors (DVMs) are shown in the per-role grid/chart but are NEVER part of
//     the company-wide averages.
//   - Company averages are computed from non-doctor, non-executive staff only.

export type EmpKind = "doctor" | "executive" | "staff";

/** One employee flattened from the roster join, ready to aggregate. */
export interface EmpInput {
  name: string;
  /** Best available job title (position.title || offer_title || adp_job_title). */
  title: string | null;
  payType: string | null;
  annualWages: number | null;
  currentRate: number | null;
  biweeklyWage: number | null;
}

export interface EmpMember {
  name: string;
  salary: number;
  title: string | null;
  outlier: "high" | "low" | null;
  /** Percent difference from the role median (signed). */
  deltaPct: number;
}

export interface RoleStats {
  role: string;
  kind: EmpKind; // "doctor" or "staff" (executives are dropped before grouping)
  count: number;
  avg: number;
  median: number;
  min: number;
  max: number;
  spread: number;
  members: EmpMember[];
  outliers: EmpMember[];
}

export interface CompanyStats {
  headcount: number;
  avg: number;
  median: number;
  min: number;
  max: number;
  totalAnnual: number;
}

export interface EmpReport {
  /** Staff roles + doctor roles, doctors sorted last. Each sorted by avg desc. */
  roles: RoleStats[];
  /** Company averages — staff only, excludes doctors and executives. */
  company: CompanyStats;
  /** Number of executives removed from the report entirely. */
  excludedExecutives: number;
  /** Employees with no computable salary (skipped from all stats). */
  missingSalary: number;
  /** Total employees considered (after excluding executives). */
  analyzed: number;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Bucket a title into doctor / executive / staff. Executive is checked first so
 * leadership titles (e.g. "Medical Director") never fall through to doctor.
 */
export function classifyKind(title: string | null | undefined): EmpKind {
  const n = (title ?? "").toLowerCase();
  if (!n.trim()) return "staff";
  if (
    /\bchief\b|\bc[a-z]o\b|\bowner\b|\bpresident\b|\bvp\b|vice president|\bdirector\b|legal counsel|\bhead of\b/.test(
      n,
    )
  ) {
    return "executive";
  }
  if (
    /\bdvm\b|\bvmd\b|veterinarian|doctor of veterinary|cardiolog|relief (vet|dvm)|veterinary intern|foreign veterinary/.test(
      n,
    )
  ) {
    return "doctor";
  }
  return "staff";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Collapse a free-text title into a stable role group for averaging. */
export function normalizeRole(
  title: string | null | undefined,
  kind: EmpKind,
): string {
  const raw = (title ?? "").trim();
  if (!raw) return "Unspecified";
  const n = raw.toLowerCase();

  if (kind === "doctor") {
    if (/intern|extern|foreign veterinary/.test(n)) return "Veterinary Intern";
    if (/cardiolog/.test(n)) return "Cardiologist";
    if (/relief/.test(n)) return "Relief DVM";
    return "Veterinarian (DVM)";
  }

  if (/\bcsr\b|\brcsr\b|client service|reception|front desk/.test(n)) {
    if (/manager|lead|supervisor/.test(n)) return "CSR Lead / Manager";
    if (/remote|rcsr/.test(n)) return "Remote CSR";
    return "CSR";
  }
  if (/groom/.test(n)) return "Groomer";
  if (/\bvts\b|\bcvt\b|\brvt\b|\blvt\b|vet(erinary)? tech|\btech\b/.test(n)) {
    return "Veterinary Technician";
  }
  if (/practice manager/.test(n)) return "Practice Manager";
  if (/\bda\b|vet(erinary)? assistant|assistant/.test(n)) {
    return "Veterinary Assistant";
  }
  if (/dental/.test(n)) return "Dental";
  if (/float/.test(n)) return "Float";
  if (/kennel|caretaker|attendant|ward/.test(n)) return "Kennel / Caretaker";
  if (/marketing|social media|content/.test(n)) return "Marketing";
  if (/account|bookkeep|finance|payroll/.test(n)) return "Accounting / Finance";
  if (/\bhr\b|human resource|recruit|talent/.test(n)) return "HR / Recruiting";
  if (/manager|supervisor/.test(n)) return "Manager / Supervisor";
  if (/lead/.test(n)) return "Team Lead";
  if (/intern/.test(n)) return "Intern";
  return titleCase(raw);
}

// ---------------------------------------------------------------------------
// Salary normalization
// ---------------------------------------------------------------------------

const HOURS_PER_YEAR = 2080; // 40h/wk * 52
const PERIODS_PER_YEAR = 26; // biweekly

/**
 * Best-effort annual salary. `annual_wages` is the pre-normalized figure when
 * present; otherwise derive it from the rate per pay type, or from the biweekly
 * wage. Returns null when nothing usable is available.
 */
export function annualizeSalary(emp: EmpInput): number | null {
  if (emp.annualWages != null && emp.annualWages > 0) return emp.annualWages;
  const rate = emp.currentRate;
  if (rate != null && rate > 0) {
    if (emp.payType === "hourly") return rate * HOURS_PER_YEAR;
    if (emp.payType === "salary") return rate;
    // day_rate / contract rates aren't reliably annualizable — fall through.
  }
  if (emp.biweeklyWage != null && emp.biweeklyWage > 0) {
    return emp.biweeklyWage * PERIODS_PER_YEAR;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolated quantile on an already-sorted ascending array. */
function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildRole(role: string, kind: EmpKind, people: EmpMember[]): RoleStats {
  const salaries = people.map((p) => p.salary).sort((a, b) => a - b);
  const med = median(salaries);

  // Tukey fences for outliers, but only when the group is large enough that
  // quartiles are meaningful. Smaller roles get no outlier flags.
  let low = -Infinity;
  let high = Infinity;
  if (salaries.length >= 4) {
    const q1 = quantile(salaries, 0.25);
    const q3 = quantile(salaries, 0.75);
    const iqr = q3 - q1;
    low = q1 - 1.5 * iqr;
    high = q3 + 1.5 * iqr;
  }

  const members = people
    .map((p) => {
      const outlier =
        p.salary > high ? "high" : p.salary < low ? "low" : null;
      const deltaPct = med > 0 ? ((p.salary - med) / med) * 100 : 0;
      return { ...p, outlier, deltaPct } as EmpMember;
    })
    .sort((a, b) => b.salary - a.salary);

  return {
    role,
    kind,
    count: members.length,
    avg: mean(salaries),
    median: med,
    min: salaries[0],
    max: salaries[salaries.length - 1],
    spread: salaries[salaries.length - 1] - salaries[0],
    members,
    outliers: members.filter((m) => m.outlier !== null),
  };
}

/**
 * Turn a list of roster employees into the full Emp Reporting payload:
 * per-role stats (staff + doctors) plus company averages (staff only).
 */
export function buildEmpReport(employees: EmpInput[]): EmpReport {
  let excludedExecutives = 0;
  let missingSalary = 0;

  // role -> { kind, members }
  const groups = new Map<string, { kind: EmpKind; members: EmpMember[] }>();
  const companySalaries: number[] = [];

  for (const emp of employees) {
    const kind = classifyKind(emp.title);
    if (kind === "executive") {
      excludedExecutives += 1;
      continue;
    }
    const salary = annualizeSalary(emp);
    if (salary == null) {
      missingSalary += 1;
      continue;
    }

    const role = normalizeRole(emp.title, kind);
    const group = groups.get(role) ?? { kind, members: [] };
    group.members.push({
      name: emp.name,
      salary,
      title: emp.title,
      outlier: null,
      deltaPct: 0,
    });
    groups.set(role, group);

    // Company averages exclude doctors (and executives, already skipped).
    if (kind === "staff") companySalaries.push(salary);
  }

  const roles = [...groups.entries()]
    .map(([role, g]) => buildRole(role, g.kind, g.members))
    // Staff roles first (by avg desc), then doctor roles (by avg desc).
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "doctor" ? 1 : -1;
      return b.avg - a.avg;
    });

  const sortedCompany = [...companySalaries].sort((a, b) => a - b);
  const company: CompanyStats = {
    headcount: sortedCompany.length,
    avg: mean(sortedCompany),
    median: median(sortedCompany),
    min: sortedCompany[0] ?? 0,
    max: sortedCompany[sortedCompany.length - 1] ?? 0,
    totalAnnual: sortedCompany.reduce((s, v) => s + v, 0),
  };

  return {
    roles,
    company,
    excludedExecutives,
    missingSalary,
    analyzed: companySalaries.length + roles
      .filter((r) => r.kind === "doctor")
      .reduce((s, r) => s + r.count, 0),
  };
}
