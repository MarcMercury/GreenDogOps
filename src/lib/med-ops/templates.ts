// Board templates — the layout each Medical Board renders.
//
// Two shapes, taken from the source workbooks:
//   grid  — the Clinic Board: one row per appointment across fixed columns.
//   card  — the AP and Surgery Digital Boards: one card per patient, with a
//           drug/dosing table, procedure list, prep checklist and notes.
//
// Card values are stored in medical_board_row.card (jsonb), so a template can
// gain or drop fields without a migration.

import { BOARD_COLUMNS, type BoardColumn, type BoardTypeKey } from "./types";

export type BoardLayout = "grid" | "card";

/** A pre-filled line in the card's drug table. */
export interface MedTemplate {
  drug: string;
  /** Default route for the first (pre-med) column group. */
  route?: string;
  /** Default route for the second (induction / adjunct) column group. */
  route2?: string;
  /** Renders as a full-width labelled line rather than a drug row. */
  freeform?: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  /** Item also captures a short value (e.g. "Suture: 3-0"). */
  withText?: boolean;
}

export interface CardField {
  key: string;
  label: string;
  placeholder?: string;
}

export interface CardTemplate {
  /** Right-hand numbered panel (AP: extractions, Surgery: procedures). */
  listLabel: string;
  listRows: number;
  /** Each numbered line carries a done checkbox. */
  listHasCheck: boolean;
  /** Column-group headers over the drug table. */
  medGroups: [string, string];
  meds: MedTemplate[];
  checklist: ChecklistItem[];
  /** Extra single-line fields in the status panel. */
  statusFields: CardField[];
  statusOptions: string[];
  /** Anaesthesia block (Surgery only). */
  anesthesia: CardField[];
  /** Free-text blocks below the card. */
  notes: CardField[];
}

export interface BoardTemplate {
  layout: BoardLayout;
  columns?: BoardColumn[];
  card?: CardTemplate;
}

const AP_CARD: CardTemplate = {
  listLabel: "Extractions",
  listRows: 4,
  listHasCheck: false,
  medGroups: ["Pre-medication", "Titrated / additional"],
  meds: [
    { drug: "Torb (10mg/mL)", route: "IV", route2: "IV" },
    { drug: "Midaz (5mg/mL)", route: "IV", route2: "IV" },
    { drug: "Dex (0.5mg/ml)", route: "IV", route2: "IV" },
    { drug: "Gaba (50mg/mL)", route: "PO", route2: "PO" },
    { drug: "", route: "IV", route2: "IV" },
    { drug: "Clinda", route: "SC", route2: "SC" },
    { drug: "Antisedan", route: "IM", route2: "" },
    { drug: "IVF: ___ ml/hr", route: "", route2: "", freeform: true },
  ],
  checklist: [
    { key: "suture", label: "Suture", withText: true },
    { key: "ecollar", label: "E-collar", withText: true },
    { key: "nail_trim", label: "Nail trim / Rectal exam / Post Rads" },
    { key: "meds_tgh", label: "Meds to go home", withText: true },
    { key: "discharge_sheet", label: "Discharge / Coloring sheet" },
  ],
  statusFields: [
    { key: "estimate", label: "Estimate", placeholder: "$" },
    { key: "surgeon", label: "SX", placeholder: "Initials" },
    { key: "pickup", label: "PU", placeholder: "Time" },
  ],
  statusOptions: [
    "Not started",
    "Admitted",
    "Pre-med given",
    "Induced",
    "In procedure",
    "Recovery",
    "Ready for pickup",
    "Discharged",
  ],
  anesthesia: [],
  notes: [
    { key: "doctor_notes", label: "Doctor's notes" },
    { key: "add_services", label: "Additional services requested" },
  ],
};

const SURGERY_CARD: CardTemplate = {
  listLabel: "Surgical procedures (add location)",
  listRows: 4,
  listHasCheck: true,
  medGroups: ["Pre-medication", "Induction"],
  meds: [
    { drug: "Bup 0.5mg/ml", route: "IV", route2: "IV" },
    { drug: "Midaz 5mg/ml", route: "IV", route2: "IV" },
    { drug: "Dex 0.5mg/ml", route: "IV", route2: "IV" },
    { drug: "Alfax 10mg/ml", route: "IV", route2: "IV" },
    { drug: "", route: "IV", route2: "IV" },
    { drug: "Clinda", route: "IV", route2: "SC" },
    { drug: "Cerenia 10mg/ml", route: "IM", route2: "" },
    { drug: "Local block", route: "", route2: "" },
    { drug: "IV Fluids: ___ ml/hr", route: "", route2: "", freeform: true },
  ],
  checklist: [
    { key: "suture", label: "Suture", withText: true },
    { key: "ecollar", label: "E-collar", withText: true },
    { key: "nail_trim", label: "Nail trim / Anal glands" },
    { key: "meds_prepped", label: "Meds prepped" },
    { key: "discharge_prepped", label: "Discharge prepped" },
  ],
  statusFields: [
    { key: "invoice_status", label: "Invoice", placeholder: "Invoice status" },
    { key: "surgeon", label: "SX", placeholder: "Initials" },
    { key: "pickup", label: "PU", placeholder: "Time" },
  ],
  statusOptions: [
    "Not started",
    "Admitted",
    "Pre-med given",
    "Induced",
    "In surgery",
    "Recovery",
    "Ready for pickup",
    "Discharged",
  ],
  anesthesia: [
    { key: "iso_range", label: "ISO range" },
    { key: "o2_range", label: "O2 range" },
    { key: "bag_size", label: "Re-b bag size" },
    { key: "et_tube", label: "ET tube" },
    { key: "et_depth", label: "Depth" },
  ],
  notes: [{ key: "doctor_notes", label: "Doctor's notes" }],
};

const GRID: BoardTemplate = { layout: "grid", columns: BOARD_COLUMNS };

/**
 * Exotics and IM keep the Clinic grid until those teams supply their own board;
 * AP and Surgery use the card layout from their Digital Board workbooks.
 */
export const BOARD_TEMPLATES: Record<BoardTypeKey, BoardTemplate> = {
  clinic: GRID,
  exotics: GRID,
  im: GRID,
  ap: { layout: "card", card: AP_CARD },
  surgery: { layout: "card", card: SURGERY_CARD },
};

// ---------------------------------------------------------------------------
// Card document
// ---------------------------------------------------------------------------

export interface CardMedRow {
  drawn: boolean;
  initials: string;
  given: boolean;
  drug: string;
  dose: string;
  route: string;
  drawn2: boolean;
  given2: boolean;
  dose2: string;
  route2: string;
}

export interface CardListItem {
  text: string;
  done: boolean;
}

export interface CardDoc {
  signalment?: string;
  weight_kg?: string;
  bw_done?: boolean;
  bw_type?: string;
  bw_results?: string;
  ivc?: string;
  alerts?: string;
  list?: CardListItem[];
  meds?: CardMedRow[];
  status?: string;
  checklist?: Record<string, boolean>;
  checklist_text?: Record<string, string>;
  fields?: Record<string, string>;
  anesthesia?: Record<string, string>;
  notes?: Record<string, string>;
}

export function emptyMedRow(t: MedTemplate): CardMedRow {
  return {
    drawn: false,
    initials: "",
    given: false,
    drug: t.drug,
    dose: "",
    route: t.route ?? "",
    drawn2: false,
    given2: false,
    dose2: "",
    route2: t.route2 ?? "",
  };
}

/** Fill a stored card out to the template, so new template lines appear. */
export function hydrateCard(card: CardDoc | null, tpl: CardTemplate): CardDoc {
  const doc: CardDoc = card ?? {};
  const meds = tpl.meds.map((t, i) => ({ ...emptyMedRow(t), ...(doc.meds?.[i] ?? {}) }));
  const list = Array.from({ length: tpl.listRows }, (_, i) => ({
    text: "",
    done: false,
    ...(doc.list?.[i] ?? {}),
  }));
  return { ...doc, meds, list };
}
