import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetRange, listSheetTabs } from "@/lib/google/sheets";
import { clean, emptyResult, nameKey, parseBool, type SheetSyncResult } from "./common";

/**
 * Nightly pull of the "Christinas Western Grid - Students Comprehensive" sheet
 * into the Student CRM.
 *
 * The year-grid tabs share a stable left-hand layout but drift on the right:
 * some rows are shifted by a column and the trailing column count varies per
 * tab. The left side is read by fixed index:
 *
 *   0 Type | 1 Name | 2 Location | 3 DVM | 4 Weekday | 5 Email
 *
 * The right side is resolved by anchoring on the "Grad Year" cell (always a
 * "DVM 20XX" token): the six numeric date cells sit immediately before it and
 * the stipend / completion flags immediately after, which survives the drift.
 *
 * Reconciliation (enrich matches, insert the rest, never duplicate) happens in
 * greendogops.apply_student_grid(). Port of scripts/import_students.py.
 */

const GRAD_RE = /\bDVM\s*\d{4}\b/i;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const COLORS = new Set(["green", "red", "yellow", "orange"]);
const SKIP_NAMES = new Set(["example", "16 students", "completed below", "none"]);

/**
 * Rows whose "name" cell is a scheduling placeholder rather than a real person
 * (empty holds, unfilled availability, section banners, running head-counts).
 * These must never become student records.
 */
const PLACEHOLDER_RE = new RegExp(
  "^\\s*(" +
    "\\d+\\s+students?" +
    "|.*students?\\s+avail.*" +
    "|no avail.*" +
    "|hold for.*" +
    "|extra spot" +
    "|need" +
    "|none" +
    "|example.*" +
    "|examples above.*" +
    "|updated below" +
    "|completed below" +
    "|want to hire.*" +
    "|maybe hire" +
    "|not interested" +
    "|in process.*" +
    "|cancelled" +
    "|not given yet" +
    ")\\s*$",
  "i",
);

interface StudentRecord {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  location: string | null;
  program_type: string | null;
  supervising_dvm: string | null;
  weekday_schedule: string | null;
  doc_recommendation: string | null;
  hire_interest: string | null;
  grad_year: string | null;
  stipend: string | null;
  start_date: string | null;
  end_date: string | null;
  completed: boolean | null;
  stipend_paid: boolean | null;
  check_cashed: boolean | null;
  notes: string | null;
  eligible: boolean | null;
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(" ");
  if (parts.length === 1) return { first: parts[0] || null, last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildDate(mo: string, day: string, yr: string): string | null {
  const m = Math.trunc(Number(mo));
  const d = Math.trunc(Number(day));
  const y = Math.trunc(Number(yr));
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseRow(row: string[]): StudentRecord | null {
  const cells = row.map((c) => clean(c));
  const name = cells[1] ?? "";
  if (!name || SKIP_NAMES.has(name.toLowerCase()) || PLACEHOLDER_RE.test(name)) return null;

  const rawEmail = cells[5] ?? "";
  const email = rawEmail.includes("@") ? rawEmail : null;
  const { first, last } = splitName(name);

  const rec: StudentRecord = {
    full_name: name,
    first_name: first,
    last_name: last,
    email,
    location: cells[2] || null,
    program_type: cells[0] || null,
    supervising_dvm: cells[3] || null,
    weekday_schedule: cells[4] || null,
    doc_recommendation: null,
    hire_interest: null,
    grad_year: null,
    stipend: null,
    start_date: null,
    end_date: null,
    completed: null,
    stipend_paid: null,
    check_cashed: null,
    notes: null,
    eligible: null,
  };

  // Anchor on the LAST "DVM 20XX" token — that's the Grad Year column.
  let gradIdx = -1;
  for (let i = cells.length - 1; i > 5; i--) {
    if (cells[i] && GRAD_RE.test(cells[i])) {
      gradIdx = i;
      break;
    }
  }

  if (gradIdx >= 0) {
    rec.grad_year = cells[gradIdx];
    rec.stipend = cells[gradIdx + 1] || null;
    rec.completed = parseBool(cells[gradIdx + 2]);
    rec.stipend_paid = parseBool(cells[gradIdx + 3]);
    rec.check_cashed = parseBool(cells[gradIdx + 4]);

    // Six numeric date cells immediately before the grad-year anchor.
    const dateCells = cells.slice(Math.max(6, gradIdx - 6), gradIdx);
    let midEnd = gradIdx;
    if (dateCells.length === 6 && dateCells.every((c) => c && NUMERIC_RE.test(c))) {
      rec.start_date = buildDate(dateCells[0], dateCells[1], dateCells[2]);
      rec.end_date = buildDate(dateCells[3], dateCells[4], dateCells[5]);
      midEnd = gradIdx - 6;
    }

    // Cells between email and the date block: doc-rec colour + free notes.
    const notes: string[] = [];
    for (const c of cells.slice(6, midEnd)) {
      if (!c || NUMERIC_RE.test(c)) continue;
      if (COLORS.has(c.toLowerCase()) && !rec.doc_recommendation) rec.doc_recommendation = c;
      else if (c.toLowerCase().includes("hire") && !rec.hire_interest) rec.hire_interest = c;
      else notes.push(c);
    }
    if (notes.length) rec.notes = notes.join("; ");
  }

  rec.eligible = (rec.hire_interest ?? "").toLowerCase().includes("want to hire") ? true : null;
  return rec;
}

export async function syncStudentGrid(
  spreadsheetId: string,
  configuredTabs?: string[],
): Promise<SheetSyncResult> {
  const result = emptyResult();
  const available = await listSheetTabs(spreadsheetId);
  // Read every grid tab we can find; a tab without a "Type | Name" header row
  // (e.g. "Contacts") is skipped during parsing.
  const tabs = configuredTabs?.length
    ? configuredTabs.filter((t) => available.includes(t))
    : available;

  const students = new Map<string, StudentRecord>();
  const order: string[] = [];
  const readTabs: string[] = [];

  for (const tab of tabs) {
    const grid = await readSheetRange(spreadsheetId, `${tab}!A1:AZ600`);
    const headerIdx = grid.findIndex(
      (row) => clean(row[0]).toLowerCase() === "type" && clean(row[1]).toLowerCase() === "name",
    );
    if (headerIdx < 0) continue; // not a student grid tab
    readTabs.push(tab);

    for (const row of grid.slice(headerIdx + 1)) {
      const parsed = parseRow(row);
      if (!parsed) continue;
      // Prefer email as the identity key; fall back to the name for the many
      // upcoming rotation students with no email captured yet.
      const key = parsed.email ? parsed.email.toLowerCase() : `name:${nameKey(parsed.full_name)}`;
      const existing = students.get(key);
      if (!existing) {
        students.set(key, parsed);
        order.push(key);
        continue;
      }
      // Later tabs fill in / override with non-empty values.
      for (const [field, value] of Object.entries(parsed) as [keyof StudentRecord, unknown][]) {
        if (value !== null && value !== "") {
          (existing as Record<string, unknown>)[field] = value;
        }
      }
    }
  }

  // Drop name-only records for people who also appear with an email, so the
  // richer email-keyed profile is the single record for that student.
  const emailNames = new Set(
    [...students.values()].filter((r) => r.email).map((r) => nameKey(r.full_name)),
  );
  const payload = order
    .filter((k) => !(k.startsWith("name:") && emailNames.has(k.slice("name:".length))))
    .map((k) => students.get(k)!);

  result.parsed = payload.length;
  result.notes = { tabs: readTabs };
  if (!payload.length) {
    result.issues.push({
      kind: "missing_column",
      subject: "student grid",
      detail: { tabs: available, hint: 'No tab had a "Type | Name" header row.' },
    });
    return result;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_student_grid", { payload });
  if (error) throw new Error(`apply_student_grid: ${error.message}`);
  const applied = (data ?? {}) as Record<string, unknown>;
  result.inserted = Number(applied.inserted ?? 0);
  result.updated = Number(applied.updated ?? 0);
  result.notes = { ...result.notes, total_students: applied.total_students ?? null };
  return result;
}
