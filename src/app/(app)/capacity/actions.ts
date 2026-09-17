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

// ---------------------------------------------------------------------------
// Slack report capacity — the per-weekday slot counts behind the twice-weekly
// upcoming-appointments post, plus single-date overrides for closures and
// one-off staffing changes.
// ---------------------------------------------------------------------------

const REPORT_TRACKS = new Set(["dental", "ve", "ap"]);

function reportTrack(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s && REPORT_TRACKS.has(s) ? s : null;
}

/** Upsert one (location, track, weekday) slot count. */
export async function saveReportCapacityTarget(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const location_id = str(formData.get("location_id"));
  const track = reportTrack(formData.get("track"));
  const weekdayRaw = str(formData.get("weekday"));
  const weekday = weekdayRaw == null ? NaN : parseInt(weekdayRaw, 10);
  if (!location_id || !track || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Pick a location, track and weekday." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("report_capacity_target").upsert(
    {
      location_id,
      track,
      weekday,
      capacity: Math.min(200, capacity(formData.get("capacity"))),
      updated_by: gate.current.authId,
    },
    { onConflict: "location_id,track,weekday" },
  );

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Upsert a single-date override; capacity 0 reports the track as closed. */
export async function saveReportCapacityOverride(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const location_id = str(formData.get("location_id"));
  const track = reportTrack(formData.get("track"));
  const appt_date = str(formData.get("appt_date"));
  if (!location_id || !track || !appt_date) {
    return { ok: false, error: "Pick a location, track and date." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appt_date)) {
    return { ok: false, error: "Enter the date as YYYY-MM-DD." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("report_capacity_override").upsert(
    {
      location_id,
      track,
      appt_date,
      capacity: Math.min(200, capacity(formData.get("capacity"))),
      note: str(formData.get("note")),
      created_by: gate.current.authId,
    },
    { onConflict: "location_id,track,appt_date" },
  );

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteReportCapacityOverride(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("schedule");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing override id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("report_capacity_override")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
