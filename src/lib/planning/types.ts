// Domain types and helpers for the Planning Guides module.
//
// A planning guide is STEP 1 of building a schedule: a per-location /
// per-service grid that defines, hour-by-hour, which appointment slots are
// bookable. Columns are appointment tracks (NAD/Clinic, Urgent Care, Internal
// Med, Dental, Exotics …); rows are time buckets; slots are the cells.

// ---------------------------------------------------------------------------
// Row shapes (mirror the DB tables).
// ---------------------------------------------------------------------------

export type PlanningGuideStatus = "active" | "archived";

export interface PlanningGuide {
  id: string;
  name: string;
  location_id: string | null;
  department_id: string | null;
  service_label: string | null;
  day_model: string | null;
  weekdays: number[];
  start_minute: number;
  end_minute: number;
  slot_minutes: number;
  status: PlanningGuideStatus;
  notes: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningGuideColumn {
  id: string;
  guide_id: string;
  name: string;
  color: string;
  capacity_note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningGuideSlot {
  id: string;
  guide_id: string;
  column_id: string;
  start_minute: number;
  duration_minutes: number;
  type_code: string;
  label: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GuideData {
  guide: PlanningGuide;
  columns: PlanningGuideColumn[];
  slots: PlanningGuideSlot[];
}

// ---------------------------------------------------------------------------
// Appointment-type palette — the vocabulary of slot kinds, derived from the
// GDD planning guides workbook. Kept in code so it stays editable without a
// migration; the `code` is what's stored on planning_guide_slot.type_code.
// ---------------------------------------------------------------------------

export type ApptCategory =
  | "Exam"
  | "Intake"
  | "Tech"
  | "Procedure"
  | "Specialty"
  | "Exotics"
  | "Other";

export interface ApptType {
  code: string;
  label: string;
  short: string;
  color: string;
  category: ApptCategory;
}

export const APPOINTMENT_TYPES: ApptType[] = [
  // Exam tracks
  { code: "nad", label: "NAD / OE", short: "NAD", color: "#2563eb", category: "Exam" },
  { code: "ve", label: "Vet Exam", short: "VE", color: "#0d9488", category: "Exam" },
  { code: "uc", label: "Urgent Care", short: "UC", color: "#d97706", category: "Exam" },
  // Intake
  { code: "drop", label: "Drop Off", short: "DROP", color: "#0891b2", category: "Intake" },
  // Tech
  { code: "tech", label: "Tech Appt", short: "TECH", color: "#7c3aed", category: "Tech" },
  // Procedure / specialty
  { code: "dental", label: "Dental", short: "DENT", color: "#db2777", category: "Procedure" },
  { code: "im", label: "Internal Med / US", short: "IM", color: "#9333ea", category: "Specialty" },
  { code: "acu", label: "Acupuncture", short: "ACU", color: "#65a30d", category: "Specialty" },
  // Exotics service
  { code: "ex_sick", label: "Exotic Sick / Referral", short: "EX-SICK", color: "#16a34a", category: "Exotics" },
  { code: "ex_recheck", label: "Exotic Recheck", short: "EX-RCK", color: "#15803d", category: "Exotics" },
  { code: "ex_wellness", label: "Exotic Wellness", short: "EX-WELL", color: "#22c55e", category: "Exotics" },
  { code: "ex_groom", label: "Exotic Tech / Grooming", short: "EX-GRM", color: "#4d7c0f", category: "Exotics" },
  // Structural
  { code: "block", label: "Block / Buffer", short: "BLOCK", color: "#94a3b8", category: "Other" },
  { code: "lunch", label: "Lunch", short: "LUNCH", color: "#64748b", category: "Other" },
  { code: "open", label: "Open", short: "OPEN", color: "#cbd5e1", category: "Other" },
];

const APPT_BY_CODE: Record<string, ApptType> = Object.fromEntries(
  APPOINTMENT_TYPES.map((t) => [t.code, t]),
);

const FALLBACK_APPT: ApptType = {
  code: "open",
  label: "Open",
  short: "OPEN",
  color: "#cbd5e1",
  category: "Other",
};

export function apptType(code: string | null | undefined): ApptType {
  return (code && APPT_BY_CODE[code]) || FALLBACK_APPT;
}

/** Inline-style tint for a slot chip from a hex color. */
export function apptChipStyle(color: string): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  return {
    backgroundColor: `${color}1a`,
    color,
    borderColor: `${color}59`,
  };
}

// ---------------------------------------------------------------------------
// Column presets — common appointment tracks for the "Add column" picker.
// ---------------------------------------------------------------------------

export interface ColumnPreset {
  name: string;
  color: string;
  capacity_note?: string;
}

export const COLUMN_PRESETS: ColumnPreset[] = [
  { name: "NAD / Clinic", color: "#2563eb", capacity_note: "14 NADs / OEs" },
  { name: "Urgent Care", color: "#d97706", capacity_note: "4 VEs + 4 UCs" },
  { name: "Vet Exam", color: "#0d9488" },
  { name: "Internal Med", color: "#9333ea" },
  { name: "Dental Clinic", color: "#db2777" },
  { name: "Exotics", color: "#16a34a" },
];

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function weekdaysLabel(days: number[]): string {
  if (!days.length) return "Any day";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d] ?? "?")
    .join(", ");
}

// ---------------------------------------------------------------------------
// Time helpers — guides store minutes-from-midnight for portability.
// ---------------------------------------------------------------------------

/** "9:00 AM" → 540. Accepts "HH:MM" (24h) or minutes. */
export function parseMinutes(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 540 → "09:00" (24h, for inputs). */
export function minutesToInput(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 540 → "9a", 570 → "9:30a", 780 → "1p". Compact grid label. */
export function minutesToLabel(min: number): string {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "p" : "a";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

/** Fixed visual grid resolution: the day is always drawn in 15-minute windows,
 *  with heavier markers at the half-hour and hour. */
export const GRID_STEP_MINUTES = 15;

/** The list of time buckets (minutes) for a guide's grid rows. Rows are always
 *  15-minute windows so the day reads at a consistent rhythm regardless of the
 *  guide's slot length. */
export function timeBuckets(guide: PlanningGuide): number[] {
  const out: number[] = [];
  for (let t = guide.start_minute; t < guide.end_minute; t += GRID_STEP_MINUTES) {
    out.push(t);
  }
  return out;
}

/** Visual weight for a grid row, used to draw hour / half-hour / quarter markers. */
export function bucketMarker(min: number): "hour" | "half" | "quarter" {
  const m = ((min % 60) + 60) % 60;
  if (m === 0) return "hour";
  if (m === 30) return "half";
  return "quarter";
}

/** Strip an embedded clock time from a slot label (e.g. "VE 9:30" → "VE").
 *  The slot's position in the grid already conveys the time, so we don't repeat
 *  it inside the chip. */
export function displaySlotLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label
    // "9:30", "9:30a", "10:00 AM", "12:15 p.m."
    .replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, "")
    // "9a", "10 pm", "9 a.m."
    .replace(/\b\d{1,2}\s*[ap]\.?m\.?(?=\b|\s|$)/gi, "")
    // trim leftover separators left behind by the removal
    .replace(/^[\s·\-–—,@]+|[\s·\-–—,@]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Total bookable (non block/lunch/open) slots in a guide. */
export function countBookable(slots: PlanningGuideSlot[]): number {
  return slots.filter(
    (s) => !["open", "block", "lunch"].includes(s.type_code),
  ).length;
}
