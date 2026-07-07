"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Parse an optional staffing-condition count (0–20); null = wildcard. */
function staffCount(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return n;
}

/** Parse the required appointment capacity (0–500). */
function capacity(v: FormDataEntryValue | null): number {
  const s = str(v);
  const n = s == null ? 0 : parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(500, n);
}

function weekdaysFrom(formData: FormData): number[] {
  return formData
    .getAll("weekdays")
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function revalidate() {
  revalidatePath("/capacity");
  revalidatePath("/planning");
}

/**
 * Build the staffing condition + capacity payload shared by create and update.
 * `department_id` (the schedule area) is required; a blank location means the
 * rule applies to any location for that area.
 */
function rulePayload(formData: FormData) {
  return {
    location_id: str(formData.get("location_id")),
    department_id: str(formData.get("department_id")),
    label: str(formData.get("label")),
    weekdays: weekdaysFrom(formData),
    dvm_count: staffCount(formData.get("dvm_count")),
    tech_count: staffCount(formData.get("tech_count")),
    lead_count: staffCount(formData.get("lead_count")),
    dental_count: staffCount(formData.get("dental_count")),
    da_count: staffCount(formData.get("da_count")),
    float_count: staffCount(formData.get("float_count")),
    appointment_capacity: capacity(formData.get("appointment_capacity")),
  };
}

export async function createCapacityRule(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const payload = rulePayload(formData);
  if (!payload.department_id) {
    return { ok: false, error: "Select a schedule area for this rule." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("planning_capacity_rule")
    .insert({
      ...payload,
      status: "active",
      created_by: gate.current.authId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateCapacityRule(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing rule id." };

  const payload = rulePayload(formData);
  if (!payload.department_id) {
    return { ok: false, error: "Select a schedule area for this rule." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("planning_capacity_rule")
    .update(payload)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteCapacityRule(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing rule id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("planning_capacity_rule")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
