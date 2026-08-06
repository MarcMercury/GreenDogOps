"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import {
  isBooleanField,
  isEditableField,
  type BoardTypeKey,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Boards are a live floor tool that the WHOLE team keeps current, so any user
 * who can see the module may edit it — unlike most modules, this deliberately
 * gates on access rather than canEditModule (Staff is read-only elsewhere).
 */
async function ensureBoardUser() {
  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) return null;
  return current;
}

/** Update a single cell. Called on blur / toggle from the board grid. */
export async function updateBoardCell(
  rowId: string,
  field: string,
  value: string | boolean | null,
): Promise<ActionResult> {
  const current = await ensureBoardUser();
  if (!current) return { ok: false, error: "Not authorized." };
  if (!isEditableField(field)) return { ok: false, error: "Unknown field." };

  const next = isBooleanField(field)
    ? Boolean(value)
    : typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("medical_board_row")
    .update({ [field]: next, updated_by: current.email })
    .eq("id", rowId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Add a walk-in / add-on row that isn't in the Agenda. */
export async function addBoardRow(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<ActionResult<MedicalBoardRow>> {
  const current = await ensureBoardUser();
  if (!current) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("medical_board_row")
    .select("sort_order")
    .eq("location_id", locationId)
    .eq("board_date", date)
    .eq("board_type", boardType)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("medical_board_row")
    .insert({
      location_id: locationId,
      board_date: date,
      board_type: boardType,
      appt_key: `manual:${crypto.randomUUID()}`,
      source: "manual",
      sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10,
      updated_by: current.email,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/med-ops/medical-boards");
  return { ok: true, data: data as MedicalBoardRow };
}

/** Remove a row from the board (manual rows, or cancelled appointments). */
export async function deleteBoardRow(rowId: string): Promise<ActionResult> {
  const current = await ensureBoardUser();
  if (!current) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("medical_board_row")
    .delete()
    .eq("id", rowId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Re-pull the Agenda for this board — picks up newly booked appointments. */
export async function syncBoardFromAgenda(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<ActionResult<number>> {
  const current = await ensureBoardUser();
  if (!current) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("medical_board_seed", {
    p_location: locationId,
    p_date: date,
    p_board_type: boardType,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: typeof data === "number" ? data : 0 };
}

/** Fetch the current rows — used by the live-sync poller/realtime refresh. */
export async function fetchBoardRows(
  locationId: string,
  date: string,
  boardType: BoardTypeKey,
): Promise<MedicalBoardRow[]> {
  const current = await ensureBoardUser();
  if (!current) return [];

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

/**
 * Merge a patch into a patient card. Server-side merging keeps two people
 * editing different fields of the same patient from overwriting each other.
 */
export async function patchBoardCard(
  rowId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const current = await ensureBoardUser();
  if (!current) return { ok: false, error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("medical_board_patch_card", {
    p_row: rowId,
    p_patch: patch,
    p_actor: current.email,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
