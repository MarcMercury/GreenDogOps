import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  BOARD_TYPES,
  type BoardTypeDef,
  type BoardTypeKey,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";

export interface BoardLocation {
  id: string;
  name: string;
  display_name: string | null;
  short_code: string | null;
  color: string | null;
}

/** Active physical clinic locations that host medical boards. */
export async function getBoardLocations(): Promise<BoardLocation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, display_name, short_code, color")
    .eq("is_active", true)
    .eq("kind", "clinic")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as BoardLocation[];
}

/** Resolve a location by its URL slug (short_code, case-insensitive) or id. */
export async function getBoardLocationBySlug(
  slug: string,
): Promise<BoardLocation | null> {
  const locations = await getBoardLocations();
  const target = slug.toLowerCase();
  return (
    locations.find(
      (l) => (l.short_code ?? "").toLowerCase() === target || l.id === slug,
    ) ?? null
  );
}

/**
 * Pull the day's appointments from the latest Agenda snapshot onto the board.
 * Insert-only, so it never overwrites the team's edits (see medical_board_seed).
 */
export async function seedBoard(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("medical_board_seed", {
    p_location: locationId,
    p_date: date,
    p_board_type: boardType,
  });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

/** Every row on one day's board, in board order. */
export async function getBoardRows(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<MedicalBoardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("medical_board_row")
    .select("*")
    .eq("location_id", locationId)
    .eq("board_date", date)
    .eq("board_type", boardType)
    .order("sort_order", { ascending: true })
    .order("appt_time", { ascending: true });
  return (data ?? []) as MedicalBoardRow[];
}

export interface BoardDay {
  location_id: string;
  board_date: string;
  board_type: BoardTypeKey;
  status: "open" | "archived";
  seeded_count: number;
  archived_at: string | null;
}

/** The board header, if a board was ever built for this day. */
export async function getBoardDay(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<BoardDay | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("medical_board_day")
    .select("location_id, board_date, board_type, status, seeded_count, archived_at")
    .eq("location_id", locationId)
    .eq("board_date", date)
    .eq("board_type", boardType)
    .maybeSingle();
  return (data as BoardDay | null) ?? null;
}

/** Dates that have at least one board, newest first — for the archive picker. */
export async function getArchivedDates(limit = 180): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("medical_board_day")
    .select("board_date")
    .order("board_date", { ascending: false })
    .limit(limit * 15);
  const seen = new Set<string>();
  for (const r of (data ?? []) as { board_date: string }[]) seen.add(r.board_date);
  return [...seen].slice(0, limit);
}

/**
 * The board-type catalog. This is the source of truth (the rollover
 * auto-registers a board for any department that starts taking appointments),
 * so the UI must read it rather than a hard-coded list.
 */
export async function getBoardTypes(): Promise<BoardTypeDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("medical_board_type")
    .select("key, label, dept_code, layout, icon, accent")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });
  const rows = (data ?? []) as {
    key: string;
    label: string;
    dept_code: string;
    layout: "grid" | "card";
    icon: string;
    accent: string;
  }[];
  if (rows.length === 0) return BOARD_TYPES;
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    deptCode: r.dept_code,
    icon: r.icon,
    accent: r.accent,
    layout: r.layout,
  }));
}

export interface CoverageRow {
  location_id: string;
  location_name: string;
  dept_code: string;
  dept_name: string;
  board_type: string | null;
  board_label: string | null;
  appointments: number;
  on_board: number;
}

/** Agenda-vs-board reconciliation for a day, so shortfalls are visible. */
export async function getBoardCoverage(date: string): Promise<CoverageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("medical_board_coverage", { p_date: date });
  return (data ?? []) as CoverageRow[];
}

