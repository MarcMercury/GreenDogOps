// Med Ops — Medical Boards domain model.
//
// A "board" is a per-location, per-department daily workflow view seeded from
// the ezyVet Agenda report (ezyvet_agenda_appt_snapshot). Each board type maps
// to a sched_department by its stable CODE, so board types survive department
// renames (e.g. "NAD" was renamed "NAD/VE/UC" but its code stayed "NAD").

export type BoardTypeKey = "ap" | "clinic" | "exotics" | "im" | "surgery";

export interface BoardTypeDef {
  key: BoardTypeKey;
  /** Tile label and board page title. */
  label: string;
  /** Compact label for chips/badges. */
  short: string;
  /** sched_department.code this board draws its appointments from. */
  deptCode: string;
  icon: string;
  /** Accent color for the tile (hex). */
  accent: string;
}

export const BOARD_TYPES: BoardTypeDef[] = [
  { key: "ap", label: "AP Board", short: "AP", deptCode: "AP", icon: "🩺", accent: "#0d9488" },
  { key: "clinic", label: "Clinic Board", short: "Clinic", deptCode: "NAD", icon: "🏥", accent: "#2563eb" },
  { key: "exotics", label: "Exotics Board", short: "Exotics", deptCode: "EXO", icon: "🦎", accent: "#16a34a" },
  { key: "im", label: "IM Board", short: "IM", deptCode: "IM", icon: "🔬", accent: "#7c3aed" },
  { key: "surgery", label: "Surgery Board", short: "Surgery", deptCode: "SURG", icon: "🔪", accent: "#e11d48" },
];

export const BOARD_TYPE_MAP: Record<BoardTypeKey, BoardTypeDef> = Object.fromEntries(
  BOARD_TYPES.map((b) => [b.key, b]),
) as Record<BoardTypeKey, BoardTypeDef>;

export function boardType(key: string | undefined): BoardTypeDef | null {
  if (!key) return null;
  return BOARD_TYPE_MAP[key as BoardTypeKey] ?? null;
}

/** URL slug for a location — its short_code when present, else its id. */
export function locationSlug(loc: { short_code: string | null; id: string }): string {
  return (loc.short_code ?? loc.id).toLowerCase();
}

// ---------------------------------------------------------------------------
// Board rows
// ---------------------------------------------------------------------------

export interface MedicalBoardRow {
  id: string;
  location_id: string;
  board_date: string;
  board_type: BoardTypeKey;
  appt_key: string;
  source: "agenda" | "manual";
  sort_order: number;
  appt_time: string | null;
  patient: string | null;
  client_name: string | null;
  appt_type: string | null;
  appt_description: string | null;
  is_out: boolean;
  pmc: boolean;
  emr: boolean;
  csr: string | null;
  tech: string | null;
  dt: string | null;
  weight_kg: string | null;
  fas_score: string | null;
  de: boolean;
  status: string | null;
  medical_hx: string | null;
  services: string | null;
  services_done: boolean;
  sedation: string | null;
  sedation_done: boolean;
  cbfc: string | null;
  owner_ud: string | null;
  room: string | null;
  lab: boolean;
  sed: boolean;
  ev: boolean;
  inv: boolean;
  da: boolean;
  mp: boolean;
  ds: boolean;
  notes: string | null;
  card: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: string;
}

/** Columns a user may edit on the board. */
export type EditableField =
  | "appt_time" | "patient" | "client_name"
  | "is_out" | "pmc" | "emr" | "csr" | "tech" | "dt" | "weight_kg"
  | "fas_score" | "de" | "status" | "medical_hx" | "services"
  | "services_done" | "sedation" | "sedation_done" | "cbfc" | "owner_ud"
  | "room" | "lab" | "sed" | "ev" | "inv" | "da" | "mp" | "ds" | "notes";

const EDITABLE: EditableField[] = [
  "appt_time", "patient", "client_name",
  "is_out", "pmc", "emr", "csr", "tech", "dt", "weight_kg",
  "fas_score", "de", "status", "medical_hx", "services",
  "services_done", "sedation", "sedation_done", "cbfc", "owner_ud",
  "room", "lab", "sed", "ev", "inv", "da", "mp", "ds", "notes",
];

const BOOLEAN_FIELDS = new Set<EditableField>([
  "is_out", "pmc", "emr", "de", "services_done", "sedation_done",
  "lab", "sed", "ev", "inv", "da", "mp", "ds",
]);

export function isEditableField(field: string): field is EditableField {
  return (EDITABLE as string[]).includes(field);
}

export function isBooleanField(field: EditableField): boolean {
  return BOOLEAN_FIELDS.has(field);
}

export type ColumnKind = "check" | "text" | "select";

export interface BoardColumn {
  key: EditableField;
  /** Header text — kept to the spreadsheet's abbreviations the team knows. */
  label: string;
  kind: ColumnKind;
  /** Tailwind width class for the cell. */
  width: string;
  /** Tooltip expanding the abbreviation. */
  title?: string;
  options?: string[];
}

export const FAS_OPTIONS = [
  "FAS 0-1 (GO)",
  "FAS 2-3 (CAUTION)",
  "FAS 4-5 (STOP)",
];

export const STATUS_OPTIONS = [
  "CHECKED IN",
  "IN ROOM",
  "WITH DVM",
  "IN TREATMENT",
  "OE DONE",
  "VE DONE",
  "SERVICES DONE",
  "SED NAD DONE",
  "READY FOR DISCHARGE",
  "DISCHARGED",
];

/**
 * The board grid, mirroring the Clinic Board spreadsheet left-to-right so the
 * team's muscle memory carries over. Same columns for every board type in v1.
 */
export const BOARD_COLUMNS: BoardColumn[] = [
  { key: "is_out", label: "OUT", kind: "check", width: "w-12", title: "Patient is out / discharged" },
  { key: "appt_time", label: "APT", kind: "text", width: "w-20", title: "Appointment time" },
  { key: "pmc", label: "PMC", kind: "check", width: "w-12", title: "Pre-med check" },
  { key: "emr", label: "EMR", kind: "check", width: "w-12", title: "EMR updated" },
  { key: "patient", label: "PATIENT", kind: "text", width: "w-52" },
  { key: "client_name", label: "CLIENT", kind: "text", width: "w-40" },
  { key: "csr", label: "CSR", kind: "text", width: "w-16", title: "Client service rep" },
  { key: "tech", label: "TECH", kind: "text", width: "w-20" },
  { key: "dt", label: "DT", kind: "text", width: "w-16", title: "Doctor / DVM tech" },
  { key: "weight_kg", label: "WT (KG)", kind: "text", width: "w-20", title: "Weight in kg" },
  { key: "fas_score", label: "FAS SCORE", kind: "select", width: "w-40", title: "Fear, Anxiety & Stress score", options: FAS_OPTIONS },
  { key: "de", label: "DE", kind: "check", width: "w-12", title: "Doctor exam" },
  { key: "status", label: "STATUS", kind: "select", width: "w-44", options: STATUS_OPTIONS },
  { key: "medical_hx", label: "MEDICAL HX", kind: "text", width: "w-64", title: "Medical history / cautions" },
  { key: "services", label: "SERVICES / ADD ONS", kind: "text", width: "w-72" },
  { key: "services_done", label: "DONE", kind: "check", width: "w-12", title: "Services complete" },
  { key: "sedation", label: "SEDATION", kind: "text", width: "w-56", title: "Sedation protocol / dosing" },
  { key: "sedation_done", label: "DONE", kind: "check", width: "w-12", title: "Sedation given" },
  { key: "cbfc", label: "CBFC", kind: "text", width: "w-24", title: "Call back / follow-up call" },
  { key: "owner_ud", label: "OWNER U/D", kind: "text", width: "w-28", title: "Owner update / discharge" },
  { key: "room", label: "RM #", kind: "text", width: "w-16", title: "Room number" },
  { key: "lab", label: "LAB", kind: "check", width: "w-12" },
  { key: "sed", label: "SED", kind: "check", width: "w-12", title: "Sedation required" },
  { key: "ev", label: "EV", kind: "check", width: "w-12", title: "Exam verified" },
  { key: "inv", label: "INV", kind: "check", width: "w-12", title: "Invoiced" },
  { key: "da", label: "DA", kind: "check", width: "w-12", title: "Doctor approved" },
  { key: "mp", label: "MP", kind: "check", width: "w-12", title: "Medical plan" },
  { key: "ds", label: "DS", kind: "check", width: "w-12", title: "Discharge summary" },
];

/** Tone classes for a FAS score, so risk reads at a glance. */
export function fasTone(value: string | null): string {
  if (!value) return "";
  if (value.startsWith("FAS 0")) return "bg-emerald-50 text-emerald-700";
  if (value.startsWith("FAS 2")) return "bg-amber-50 text-amber-700";
  if (value.startsWith("FAS 4")) return "bg-rose-50 text-rose-700";
  return "";
}

/** Tone classes for a workflow status. */
export function statusTone(value: string | null): string {
  if (!value) return "";
  const v = value.toUpperCase();
  if (v.includes("DISCHARG")) return "bg-slate-100 text-slate-600";
  if (v.includes("DONE") || v.includes("READY")) return "bg-emerald-50 text-emerald-700";
  if (v.includes("DVM") || v.includes("TREATMENT") || v.includes("ROOM")) return "bg-sky-50 text-sky-700";
  if (v.includes("CHECKED")) return "bg-indigo-50 text-indigo-700";
  return "bg-slate-50 text-slate-600";
}

