import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { readSheetRange } from "@/lib/google/sheets";
import { normalizeJobTitle } from "@/lib/hr/job-titles";
import {
  cell,
  clean,
  emptyResult,
  isFormulaError,
  nameKey,
  parseMoney,
  parseNumber,
  parseSheetDate,
  type SheetSyncResult,
  type SyncIssue,
} from "./common";

/**
 * Nightly reconcile of greendogops.person / person_employment against the HR
 * "Merit Increase Calculator" workbook, which HR keeps current.
 *
 * Applied automatically (provably safe):
 *   - people on the 2026 tab with no person row      -> insert
 *   - people on the Former tab still marked active   -> status 'former'
 *   - people on the 2026 tab not active in the DB    -> reactivate
 *   - title / wage / PTO / CE / compliance drift     -> update
 *   - grid_name corrections                          -> update, unless the new
 *     value is another active employee's own name
 *
 * Filed for review instead of applied:
 *   - an active employee on NEITHER tab (absence is not proof of separation)
 *   - a GRID NAME that belongs to a different active employee
 *   - duplicate person rows sharing a name
 *
 * This is the server-side twin of scripts/reconcile_hr_roster.mjs, which stays
 * around for dry-run reporting from a terminal.
 */

const DEFAULT_CURRENT_TAB = "2026 EMP PROFILE DATA";
const DEFAULT_FORMER_TAB = "Former Employees";

/** Rows whose Full Name is one of these are section separators, not people. */
const SECTION_MARKERS = new Set(["others", "1099", "new", "inactive 1099", "inactive"]);

const ACTIVE_STATUSES = new Set(["employee", "contractor"]);

/** Header text -> logical column. Headers carry years and line breaks, so each
 *  is matched by pattern rather than by a fixed index. */
const COLUMN_PATTERNS: Record<string, RegExp> = {
  full_name: /^full name$/,
  grid_name: /^grid name$/,
  first_name: /^first name$/,
  last_name: /^last name$/,
  dob: /^dob$/,
  zip: /^zip code$/,
  work_location: /in-?house or remote/,
  offer_title: /offer letter.*title/,
  adp_job_title: /^adp job title$/,
  hire_date: /^hire date$/,
  type: /^type$/,
  status: /^status$/,
  days_per_week: /^days per week$/,
  latest_wage_change_date: /latest wage change/,
  current_rate: /current hourly rate/,
  previous_rate: /previous wage/,
  biweekly_wage: /bi-?weekly wage/,
  annual_wages: /annual wages/,
  pto_allotment: /pto allotment$/,
  pto_policy_allotment: /pto policy allotment/,
  pto_used: /pto used/,
  pto_available: /pto available/,
  pto_notes: /pto request notes/,
  ce_budget: /^ce budget/,
  ce_used: /^ce used$/,
  ce_remaining: /^ce remaining$/,
};

/** Compliance checkbox columns -> person_employment.compliance keys. */
const COMPLIANCE_PATTERNS: Record<string, RegExp> = {
  offer_letter_completed: /offer letter completed/,
  handbook_signed: /handbook.*signed/,
  onboarding_completed: /onboarding completed/,
  benefits_completed: /benefits completed/,
  sexual_harassment_training_date: /sexual harassment training date/,
  harassment_pay: /harra?ssment pay/,
  background_check_processed: /background check/,
  safety_training: /safety training/,
  emergency_contact_form: /emergency contact/,
  contract_sent: /contract sent$/,
  contract_signed: /contract signed$/,
  approved_denied: /approved or denied/,
  ce_contract_sent: /continuing education contract sent/,
  ce_contract_signed: /continuing education contract signed/,
  immigration_agreement_sent: /immigration expense agreement sent/,
  immigration_agreement_signed: /immigration expense agreement signed/,
  licenses_tracked: /licenses tracked/,
};

interface SheetPerson {
  key: string;
  full_name: string;
  grid_name: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  postal_code: string | null;
  work_location_type: string | null;
  offer_title: string | null;
  adp_job_title: string | null;
  hire_date: string | null;
  flsa_status: string | null;
  work_schedule: string | null;
  days_per_week: number | null;
  latest_wage_change_date: string | null;
  current_rate: number | null;
  previous_rate: number | null;
  biweekly_wage: number | null;
  annual_wages: number | null;
  pto_allotment: string | null;
  pto_policy_allotment: number | null;
  pto_used: number | null;
  pto_available: number | null;
  pto_notes: string | null;
  ce_budget: number | null;
  ce_used: number | null;
  ce_remaining: number | null;
  compliance: Record<string, string>;
}

interface PersonRow {
  id: string;
  full_name: string | null;
  grid_name: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  date_of_birth: string | null;
  postal_code: string | null;
  work_location_type: string | null;
}

type EmploymentRow = Record<string, unknown> & { person_id: string };

/** Sheet "In House" / "Remote" -> greendogops.work_location_type. */
function workLocation(v: string): string | null {
  const s = v.toLowerCase();
  if (s.includes("remote")) return "remote";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("house")) return "in_house";
  return null;
}

/** Sheet "Type" column -> greendogops.flsa_status. */
function flsaStatus(v: string): string | null {
  const s = v.toLowerCase();
  if (!s) return null;
  if (s.includes("non")) return "non_exempt";
  if (s.includes("exempt")) return "exempt";
  return null;
}

/** Sheet "Status" column -> greendogops.work_schedule. */
function workSchedule(v: string): string | null {
  const s = v.toLowerCase();
  if (!s) return null;
  if (s.includes("full")) return "full_time";
  if (s.includes("part")) return "part_time";
  if (s.includes("diem")) return "per_diem";
  if (s.includes("contract") || s.includes("relief")) return "contractor";
  return null;
}

/** Exempt staff are salaried; everyone else is paid hourly on this sheet. */
function payType(flsa: string | null): string | null {
  if (flsa === "exempt") return "salary";
  if (flsa === "non_exempt") return "hourly";
  return null;
}

function resolveColumns(header: string[], patterns: Record<string, RegExp>): Record<string, number> {
  const normalized = header.map((h) => clean(h).toLowerCase());
  const out: Record<string, number> = {};
  for (const [key, re] of Object.entries(patterns)) {
    const idx = normalized.findIndex((h) => re.test(h));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}

function parseCurrentTab(grid: string[][]): { people: SheetPerson[]; missingColumns: string[] } {
  const header = (grid[1] ?? []).map(clean);
  const col = resolveColumns(header, COLUMN_PATTERNS);
  const complianceCol = resolveColumns(header, COMPLIANCE_PATTERNS);
  const missingColumns = Object.keys(COLUMN_PATTERNS).filter((k) => !(k in col));

  const people: SheetPerson[] = [];
  for (const row of grid.slice(2)) {
    const fullName = cell(row, col.full_name ?? 0);
    if (!fullName || SECTION_MARKERS.has(fullName.toLowerCase())) continue;

    const compliance: Record<string, string> = {};
    for (const [key, idx] of Object.entries(complianceCol)) {
      const v = cell(row, idx);
      if (v) compliance[key] = v;
    }

    const flsa = flsaStatus(cell(row, col.type ?? -1));
    const grid_name = cell(row, col.grid_name ?? -1);

    people.push({
      key: nameKey(fullName),
      full_name: fullName,
      grid_name: isFormulaError(grid_name) ? "" : grid_name,
      first_name: cell(row, col.first_name ?? -1),
      last_name: cell(row, col.last_name ?? -1),
      date_of_birth: parseSheetDate(cell(row, col.dob ?? -1)),
      postal_code: cell(row, col.zip ?? -1) || null,
      work_location_type: workLocation(cell(row, col.work_location ?? -1)),
      // The sheet spells the same role several ways; every write path funnels
      // through the canonical map so the /hr Title filter stays deduplicated.
      offer_title: normalizeJobTitle(cell(row, col.offer_title ?? -1)),
      adp_job_title: normalizeJobTitle(cell(row, col.adp_job_title ?? -1)),
      hire_date: parseSheetDate(cell(row, col.hire_date ?? -1)),
      flsa_status: flsa,
      work_schedule: workSchedule(cell(row, col.status ?? -1)),
      days_per_week: parseNumber(cell(row, col.days_per_week ?? -1)),
      latest_wage_change_date: parseSheetDate(cell(row, col.latest_wage_change_date ?? -1)),
      current_rate: parseMoney(cell(row, col.current_rate ?? -1)),
      previous_rate: parseMoney(cell(row, col.previous_rate ?? -1)),
      biweekly_wage: parseMoney(cell(row, col.biweekly_wage ?? -1)),
      annual_wages: parseMoney(cell(row, col.annual_wages ?? -1)),
      pto_allotment: cell(row, col.pto_allotment ?? -1) || null,
      pto_policy_allotment: parseMoney(cell(row, col.pto_policy_allotment ?? -1)),
      pto_used: parseMoney(cell(row, col.pto_used ?? -1)),
      pto_available: parseMoney(cell(row, col.pto_available ?? -1)),
      pto_notes: cell(row, col.pto_notes ?? -1) || null,
      ce_budget: parseMoney(cell(row, col.ce_budget ?? -1)),
      ce_used: parseMoney(cell(row, col.ce_used ?? -1)),
      ce_remaining: parseMoney(cell(row, col.ce_remaining ?? -1)),
      compliance,
    });
  }
  return { people, missingColumns };
}

/**
 * The bottom of the Former tab was pasted in using the 2026 tab's column
 * layout, so only column A (Full Name) is trustworthy there. Presence on the
 * tab is what drives the status change; the date is display-only.
 */
const DATEISH = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$|^\d{1,2}\/\d{4}$/;

function parseFormerTab(grid: string[][]): { key: string; full_name: string; last_day: string }[] {
  const header = (grid[1] ?? []).map(clean);
  const lastDayIdx = header.findIndex((h) => /last day/i.test(h));
  const out: { key: string; full_name: string; last_day: string }[] = [];
  for (const row of grid.slice(2)) {
    const fullName = cell(row, 0);
    if (!fullName || SECTION_MARKERS.has(fullName.toLowerCase())) continue;
    const raw = lastDayIdx >= 0 ? cell(row, lastDayIdx) : "";
    out.push({ key: nameKey(fullName), full_name: fullName, last_day: DATEISH.test(raw) ? raw : "" });
  }
  return out;
}

/** Employment fields the sheet owns, in person_employment column order. */
function desiredEmployment(p: SheetPerson): Record<string, unknown> {
  return {
    offer_title: p.offer_title,
    adp_job_title: p.adp_job_title,
    flsa_status: p.flsa_status,
    work_schedule: p.work_schedule,
    days_per_week: p.days_per_week,
    hire_date: p.hire_date,
    pay_type: payType(p.flsa_status),
    current_rate: p.current_rate,
    previous_rate: p.previous_rate,
    latest_wage_change_date: p.latest_wage_change_date,
    biweekly_wage: p.biweekly_wage,
    annual_wages: p.annual_wages,
    pto_allotment: p.pto_allotment,
    pto_policy_allotment: p.pto_policy_allotment,
    pto_used: p.pto_used,
    pto_available: p.pto_available,
    pto_notes: p.pto_notes,
    ce_budget: p.ce_budget,
    ce_used: p.ce_used,
    ce_remaining: p.ce_remaining,
  };
}

/** Numeric columns come back from PostgREST as strings ("20.50"). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof b === "number" || typeof a === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

export interface HrRosterOptions {
  currentTab?: string;
  formerTab?: string;
  /** Names as spelled on the staff schedule sheet, so a grid_name that already
   *  matches the schedule is never replaced by an HR spelling that does not. */
  scheduleNames?: Set<string>;
}

export async function syncHrRoster(
  spreadsheetId: string,
  options: HrRosterOptions = {},
): Promise<SheetSyncResult> {
  const result = emptyResult();
  const admin = createAdminClient();
  const currentTab = options.currentTab ?? DEFAULT_CURRENT_TAB;
  const formerTab = options.formerTab ?? DEFAULT_FORMER_TAB;
  const scheduleNames = options.scheduleNames ?? new Set<string>();

  const [currentGrid, formerGrid] = await Promise.all([
    readSheetRange(spreadsheetId, `${currentTab}!A1:BZ400`),
    readSheetRange(spreadsheetId, `${formerTab}!A1:BZ400`),
  ]);

  const { people: sheetPeople, missingColumns } = parseCurrentTab(currentGrid);
  const formerPeople = parseFormerTab(formerGrid);
  result.parsed = sheetPeople.length;
  result.notes = {
    current_tab_rows: sheetPeople.length,
    former_tab_rows: formerPeople.length,
  };
  if (missingColumns.length) {
    result.issues.push({
      kind: "missing_column",
      subject: currentTab,
      detail: { columns: missingColumns, hint: "The HR tab was re-arranged or renamed." },
    });
  }
  if (!sheetPeople.length) {
    // An empty parse means the tab moved or the layout changed; refuse to treat
    // it as "everyone left the company".
    throw new Error(`"${currentTab}" produced no employee rows — aborting before applying changes.`);
  }

  const roster = await fetchAllRows<PersonRow>(() =>
    admin
      .from("person")
      .select(
        "id, full_name, grid_name, first_name, last_name, status, date_of_birth, postal_code, work_location_type",
      )
      .order("id"),
  );

  // Several people have more than one person row (an old `former` row plus the
  // live one). Prefer the active row so a rehire is not mistaken for someone
  // who needs reactivating; duplicates are reported for manual merging.
  const byKeyAll = new Map<string, PersonRow[]>();
  for (const p of roster) {
    for (const n of [p.full_name, p.grid_name]) {
      const k = nameKey(n ?? "");
      if (!k) continue;
      const list = byKeyAll.get(k) ?? [];
      if (!list.some((x) => x.id === p.id)) list.push(p);
      byKeyAll.set(k, list);
    }
  }
  const byKey = new Map<string, PersonRow>();
  for (const [k, list] of byKeyAll) {
    byKey.set(k, list.find((p) => ACTIVE_STATUSES.has(p.status)) ?? list[0]);
  }

  // A GRID NAME that is another active person's own name silently hijacks their
  // identity in the When I Work name index — never apply one.
  const ownNameKeys = new Map<string, string>();
  for (const p of roster) {
    if (!ACTIVE_STATUSES.has(p.status)) continue;
    const k = nameKey(p.full_name ?? "");
    if (k) ownNameKeys.set(k, p.id);
  }

  const currentKeys = new Set(sheetPeople.map((p) => p.key));
  const issues: SyncIssue[] = result.issues;
  let inserted = 0;
  let updated = 0;

  // Tripwire. Creating a person is the one irreversible thing this sync does,
  // and the way it goes wrong is systemic (a truncated roster read, a renamed
  // tab) rather than one bad row — which shows up as "half the company is new".
  // Past that threshold, stop inserting and ask a human.
  const unmatchedCount = sheetPeople.filter((p) => !byKey.has(p.key)).length;
  const insertLimit = Math.max(10, Math.round(sheetPeople.length * 0.25));
  const insertsBlocked = unmatchedCount > insertLimit;
  if (insertsBlocked) {
    issues.push({
      kind: "too_many_new_people",
      subject: currentTab,
      detail: {
        would_insert: unmatchedCount,
        limit: insertLimit,
        roster_rows: roster.length,
        hint: "The sheet claims an implausible number of brand-new employees. No one was inserted — check that the roster loaded fully and the tab layout is unchanged.",
      },
    });
  }

  // --- separations: on the Former tab and still active -----------------------
  const terminations = new Map<string, { person: PersonRow; last_day: string }>();
  for (const f of formerPeople) {
    if (currentKeys.has(f.key)) continue; // on both tabs -> the 2026 tab wins
    const person = byKey.get(f.key);
    if (person && ACTIVE_STATUSES.has(person.status)) {
      terminations.set(person.id, { person, last_day: f.last_day });
    }
  }
  for (const { person, last_day } of terminations.values()) {
    const { error } = await admin
      .from("person")
      .update({ status: "former", status_changed_at: new Date().toISOString() })
      .eq("id", person.id);
    if (error) {
      issues.push({ kind: "apply_failed", subject: person.full_name ?? person.id, detail: { op: "terminate", error: error.message } });
      continue;
    }
    updated += 1;
    const separationDate = parseSheetDate(last_day);
    if (separationDate) {
      await admin
        .from("person_employment")
        .update({ separation_date: separationDate })
        .eq("person_id", person.id)
        .is("separation_date", null);
    }
  }

  // --- the rest of the 2026 tab ---------------------------------------------
  for (const sp of sheetPeople) {
    const existing = byKey.get(sp.key);

    if (!existing) {
      if (insertsBlocked) continue;
      const { data: created, error } = await admin
        .from("person")
        .insert({
          status: "employee",
          first_name: sp.first_name || null,
          last_name: sp.last_name || null,
          full_name: sp.full_name,
          grid_name: sp.grid_name || null,
          date_of_birth: sp.date_of_birth,
          postal_code: sp.postal_code,
          work_location_type: sp.work_location_type,
          notes: `Added by the nightly HR roster sync from "${currentTab}".`,
        })
        .select("id")
        .single();
      if (error || !created) {
        issues.push({ kind: "apply_failed", subject: sp.full_name, detail: { op: "insert", error: error?.message } });
        continue;
      }
      inserted += 1;
      const { error: empErr } = await admin
        .from("person_employment")
        .upsert({ person_id: created.id as string, ...desiredEmployment(sp), compliance: sp.compliance });
      if (empErr) {
        issues.push({ kind: "apply_failed", subject: sp.full_name, detail: { op: "insert_employment", error: empErr.message } });
      }
      continue;
    }

    // Reactivate anyone the sheet lists as current but the DB does not.
    const personPatch: Record<string, unknown> = {};
    if (!ACTIVE_STATUSES.has(existing.status)) {
      personPatch.status = "employee";
      personPatch.status_changed_at = new Date().toISOString();
    }

    // grid_name: apply corrections, but never one that collides with another
    // active employee, and never replace a spelling the schedule already uses.
    if (sp.grid_name && clean(existing.grid_name) !== sp.grid_name) {
      const owner = ownNameKeys.get(nameKey(sp.grid_name));
      const collides = owner !== undefined && owner !== existing.id;
      const wouldBreakSchedule =
        scheduleNames.has(nameKey(existing.grid_name ?? "")) && !scheduleNames.has(nameKey(sp.grid_name));
      if (collides) {
        issues.push({
          kind: "grid_name_collision",
          subject: existing.full_name ?? sp.full_name,
          detail: { sheet_grid_name: sp.grid_name, hint: "This GRID NAME is another active employee's own name. Fix the sheet." },
        });
      } else if (!wouldBreakSchedule) {
        personPatch.grid_name = sp.grid_name;
      }
    }

    // The sheet is the source of truth for these; names stay curated in the app.
    if (sp.date_of_birth && sp.date_of_birth !== existing.date_of_birth) personPatch.date_of_birth = sp.date_of_birth;
    if (sp.postal_code && sp.postal_code !== existing.postal_code) personPatch.postal_code = sp.postal_code;
    if (sp.work_location_type && sp.work_location_type !== existing.work_location_type) {
      personPatch.work_location_type = sp.work_location_type;
    }
    if (sp.first_name && !clean(existing.first_name)) personPatch.first_name = sp.first_name;
    if (sp.last_name && !clean(existing.last_name)) personPatch.last_name = sp.last_name;

    if (Object.keys(personPatch).length > 0) {
      const { error } = await admin.from("person").update(personPatch).eq("id", existing.id);
      if (error) {
        issues.push({ kind: "apply_failed", subject: sp.full_name, detail: { op: "update_person", error: error.message } });
      } else {
        updated += 1;
      }
    }
  }

  // --- employment / compensation -------------------------------------------
  const matched = sheetPeople
    .map((sp) => ({ sp, person: byKey.get(sp.key) }))
    .filter((x): x is { sp: SheetPerson; person: PersonRow } => Boolean(x.person));

  const { data: empData, error: empErr } = await admin
    .from("person_employment")
    .select("*")
    .in(
      "person_id",
      matched.map((m) => m.person.id),
    );
  if (empErr) throw new Error(`load person_employment: ${empErr.message}`);
  const employmentByPerson = new Map<string, EmploymentRow>(
    ((empData ?? []) as EmploymentRow[]).map((e) => [e.person_id, e]),
  );

  let compensationUpdates = 0;
  for (const { sp, person } of matched) {
    const existing = employmentByPerson.get(person.id);
    const desired = desiredEmployment(sp);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(desired)) {
      if (value === null || value === undefined) continue; // blank cell = no opinion
      if (!existing || !sameValue(existing[key], value)) patch[key] = value;
    }

    const mergedCompliance = { ...((existing?.compliance as Record<string, string>) ?? {}), ...sp.compliance };
    if (JSON.stringify(mergedCompliance) !== JSON.stringify(existing?.compliance ?? {})) {
      patch.compliance = mergedCompliance;
    }
    if (Object.keys(patch).length === 0) continue;

    const { error } = await admin
      .from("person_employment")
      .upsert({ person_id: person.id, ...patch }, { onConflict: "person_id" });
    if (error) {
      issues.push({ kind: "apply_failed", subject: sp.full_name, detail: { op: "update_employment", error: error.message } });
      continue;
    }
    compensationUpdates += 1;
    updated += 1;
  }

  // --- review queue ---------------------------------------------------------
  const formerKeys = new Set(formerPeople.map((f) => f.key));
  for (const p of roster) {
    if (!ACTIVE_STATUSES.has(p.status)) continue;
    if (terminations.has(p.id)) continue;
    const onSheet =
      currentKeys.has(nameKey(p.full_name ?? "")) ||
      currentKeys.has(nameKey(p.grid_name ?? "")) ||
      formerKeys.has(nameKey(p.full_name ?? ""));
    if (onSheet) continue;
    // 1099 contractors are expected to be absent — the workbook is an employee
    // comp sheet — so only employees are a question worth asking.
    if (p.status !== "employee") continue;
    issues.push({
      kind: "employee_missing_from_sheet",
      subject: p.full_name ?? p.id,
      detail: { person_id: p.id, hint: "Active in Green Dog Ops but on neither HR tab. Confirm whether they are still employed." },
    });
  }

  for (const [, list] of byKeyAll) {
    if (list.length < 2) continue;
    issues.push({
      kind: "duplicate_person_rows",
      subject: list[0].full_name ?? list[0].id,
      detail: {
        person_ids: list.map((p) => p.id),
        statuses: list.map((p) => p.status),
        hint: "Merge with greendogops.merge_person(keep_id, dup_id) after confirming they are the same person.",
      },
    });
  }

  result.inserted = inserted;
  result.updated = updated;
  result.notes = {
    ...result.notes,
    separations: terminations.size,
    compensation_updates: compensationUpdates,
  };
  return result;
}
