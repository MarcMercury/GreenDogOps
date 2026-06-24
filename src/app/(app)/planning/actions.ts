"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { APPOINTMENT_TYPES } from "@/lib/planning/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function int(v: FormDataEntryValue | null, fallback = 0): number {
  const s = str(v);
  if (s == null) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse the optional DVM-count staffing key (1–6); null = unspecified. */
function dvmCount(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > 6) return null;
  return n;
}

/** Parse an optional support-role staffing count (0–20); null = wildcard. */
function staffCount(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return n;
}

const VALID_TYPE_CODES = new Set(APPOINTMENT_TYPES.map((t) => t.code));

function revalidate() {
  revalidatePath("/planning");
}

// ===========================================================================
// GUIDES
// ===========================================================================

export async function createGuide(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "Guide name is required." };

  const start = int(formData.get("start_minute"), 540);
  const end = int(formData.get("end_minute"), 1020);
  if (end <= start) {
    return { ok: false, error: "End time must be after the start time." };
  }

  const weekdays = formData
    .getAll("weekdays")
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  const { data, error } = await supabase
    .from("planning_guide")
    .insert({
      name,
      location_id: str(formData.get("location_id")),
      department_id: str(formData.get("department_id")),
      service_label: str(formData.get("service_label")),
      day_model: str(formData.get("day_model")),
      weekdays,
      dvm_count: dvmCount(formData.get("dvm_count")),
      tech_count: staffCount(formData.get("tech_count")),
      lead_count: staffCount(formData.get("lead_count")),
      dental_count: staffCount(formData.get("dental_count")),
      da_count: staffCount(formData.get("da_count")),
      float_count: staffCount(formData.get("float_count")),
      start_minute: start,
      end_minute: end,
      slot_minutes: Math.max(5, int(formData.get("slot_minutes"), 30)),
      notes: str(formData.get("notes")),
      sort_order: int(formData.get("sort_order")),
      created_by: gate.current.authId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateGuide(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing guide id." };
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "Guide name is required." };

  const start = int(formData.get("start_minute"), 540);
  const end = int(formData.get("end_minute"), 1020);
  if (end <= start) {
    return { ok: false, error: "End time must be after the start time." };
  }

  const weekdays = formData
    .getAll("weekdays")
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  const { error } = await supabase
    .from("planning_guide")
    .update({
      name,
      location_id: str(formData.get("location_id")),
      department_id: str(formData.get("department_id")),
      service_label: str(formData.get("service_label")),
      day_model: str(formData.get("day_model")),
      weekdays,
      dvm_count: dvmCount(formData.get("dvm_count")),
      tech_count: staffCount(formData.get("tech_count")),
      lead_count: staffCount(formData.get("lead_count")),
      dental_count: staffCount(formData.get("dental_count")),
      da_count: staffCount(formData.get("da_count")),
      float_count: staffCount(formData.get("float_count")),
      start_minute: start,
      end_minute: end,
      slot_minutes: Math.max(5, int(formData.get("slot_minutes"), 30)),
      status: str(formData.get("status")) === "archived" ? "archived" : "active",
      notes: str(formData.get("notes")),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteGuide(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing guide id." };
  const { error } = await supabase.from("planning_guide").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Deep-copy a guide, its columns, and all slots into a new "(Copy)" guide. */
export async function duplicateGuide(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing guide id." };

  const { data: src } = await supabase
    .from("planning_guide")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!src) return { ok: false, error: "Guide not found." };

  const { data: newGuide, error: gErr } = await supabase
    .from("planning_guide")
    .insert({
      name: `${src.name} (Copy)`,
      location_id: src.location_id,
      department_id: src.department_id,
      service_label: src.service_label,
      day_model: src.day_model,
      weekdays: src.weekdays,
      dvm_count: src.dvm_count,
      tech_count: src.tech_count,
      lead_count: src.lead_count,
      dental_count: src.dental_count,
      da_count: src.da_count,
      float_count: src.float_count,
      start_minute: src.start_minute,
      end_minute: src.end_minute,
      slot_minutes: src.slot_minutes,
      notes: src.notes,
      sort_order: src.sort_order,
      created_by: gate.current.authId,
    })
    .select("id")
    .single();
  if (gErr) return { ok: false, error: gErr.message };
  const newId = newGuide.id as string;

  const { data: cols } = await supabase
    .from("planning_guide_column")
    .select("*")
    .eq("guide_id", id)
    .order("sort_order");

  const colIdMap = new Map<string, string>();
  for (const col of cols ?? []) {
    const { data: nc } = await supabase
      .from("planning_guide_column")
      .insert({
        guide_id: newId,
        name: col.name,
        color: col.color,
        capacity_note: col.capacity_note,
        sort_order: col.sort_order,
      })
      .select("id")
      .single();
    if (nc) colIdMap.set(col.id as string, nc.id as string);
  }

  const { data: slots } = await supabase
    .from("planning_guide_slot")
    .select("*")
    .eq("guide_id", id);

  const slotRows = (slots ?? [])
    .map((s) => {
      const newCol = colIdMap.get(s.column_id as string);
      if (!newCol) return null;
      return {
        guide_id: newId,
        column_id: newCol,
        start_minute: s.start_minute,
        duration_minutes: s.duration_minutes,
        type_code: s.type_code,
        label: s.label,
        sort_order: s.sort_order,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (slotRows.length) {
    await supabase.from("planning_guide_slot").insert(slotRows);
  }

  revalidate();
  return { ok: true, data: { id: newId } };
}

// ===========================================================================
// COLUMNS
// ===========================================================================

export async function addColumn(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const guideId = str(formData.get("guide_id"));
  const name = str(formData.get("name"));
  if (!guideId || !name) {
    return { ok: false, error: "Guide and column name are required." };
  }

  const { data, error } = await supabase
    .from("planning_guide_column")
    .insert({
      guide_id: guideId,
      name,
      color: str(formData.get("color")) ?? "#64748b",
      capacity_note: str(formData.get("capacity_note")),
      sort_order: int(formData.get("sort_order")),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateColumn(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id || !name) return { ok: false, error: "Column name is required." };
  const { error } = await supabase
    .from("planning_guide_column")
    .update({
      name,
      color: str(formData.get("color")) ?? "#64748b",
      capacity_note: str(formData.get("capacity_note")),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteColumn(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing column id." };
  const { error } = await supabase
    .from("planning_guide_column")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Swap sort_order between two columns to move one left/right. */
export async function reorderColumns(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const aId = str(formData.get("a_id"));
  const bId = str(formData.get("b_id"));
  const aSort = int(formData.get("a_sort"));
  const bSort = int(formData.get("b_sort"));
  if (!aId || !bId) return { ok: false, error: "Missing column ids." };
  await Promise.all([
    supabase
      .from("planning_guide_column")
      .update({ sort_order: bSort })
      .eq("id", aId),
    supabase
      .from("planning_guide_column")
      .update({ sort_order: aSort })
      .eq("id", bId),
  ]);
  revalidate();
  return { ok: true };
}

// ===========================================================================
// SLOTS (cells)
// ===========================================================================

/** Add a slot into a (column, time-bucket) cell. */
export async function addSlot(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();

  const guideId = str(formData.get("guide_id"));
  const columnId = str(formData.get("column_id"));
  const typeCode = str(formData.get("type_code")) ?? "open";
  if (!guideId || !columnId) {
    return { ok: false, error: "Missing guide or column." };
  }
  if (!VALID_TYPE_CODES.has(typeCode)) {
    return { ok: false, error: "Unknown appointment type." };
  }

  const { data, error } = await supabase
    .from("planning_guide_slot")
    .insert({
      guide_id: guideId,
      column_id: columnId,
      start_minute: int(formData.get("start_minute")),
      duration_minutes: Math.max(5, int(formData.get("duration_minutes"), 30)),
      type_code: typeCode,
      label: str(formData.get("label")),
      sort_order: int(formData.get("sort_order")),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateSlot(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const typeCode = str(formData.get("type_code")) ?? "open";
  if (!id) return { ok: false, error: "Missing slot id." };
  if (!VALID_TYPE_CODES.has(typeCode)) {
    return { ok: false, error: "Unknown appointment type." };
  }
  const { error } = await supabase
    .from("planning_guide_slot")
    .update({
      type_code: typeCode,
      label: str(formData.get("label")),
      duration_minutes: Math.max(5, int(formData.get("duration_minutes"), 30)),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function moveSlot(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const columnId = str(formData.get("column_id"));
  const startMinute = int(formData.get("start_minute"), -1);
  if (!id || !columnId || startMinute < 0) {
    return { ok: false, error: "Missing move parameters." };
  }
  const { error } = await supabase
    .from("planning_guide_slot")
    .update({ column_id: columnId, start_minute: startMinute })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteSlot(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("planning");
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing slot id." };
  const { error } = await supabase
    .from("planning_guide_slot")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
