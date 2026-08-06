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
