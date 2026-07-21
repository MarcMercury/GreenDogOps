"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCanEdit } from "@/lib/auth/session";
import { syncGoogleCalendar } from "@/lib/calendar/sync";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

/**
 * Build a timestamptz from a date input plus an optional time input. When no
 * time is given the event is all-day and anchored at midnight.
 */
function toTimestamp(date: string, time: string | null): string {
  if (!time) return `${date}T00:00:00`;
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

/** Create a custom calendar event (source = 'custom'). */
export async function createCustomEvent(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const title = str(formData.get("title"));
  const startDate = str(formData.get("start_date"));
  if (!title) return { ok: false, error: "Title is required." };
  if (!startDate) return { ok: false, error: "Start date is required." };

  const allDay = bool(formData.get("all_day"));
  const startTime = allDay ? null : str(formData.get("start_time"));
  const endDate = str(formData.get("end_date")) ?? startDate;
  const endTime = allDay ? null : str(formData.get("end_time"));

  const startsAt = toTimestamp(startDate, startTime);
  const endsAt =
    endTime || str(formData.get("end_date"))
      ? toTimestamp(endDate, endTime)
      : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_event")
    .insert({
      source: "custom",
      title,
      description: str(formData.get("description")),
      location: str(formData.get("location")),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: allDay,
      category: "general",
      created_by: gate.current.authId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true, data: { id: data.id as string } };
}

/** Update a custom calendar event. Google-sourced rows are not editable here. */
export async function updateCustomEvent(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  const startDate = str(formData.get("start_date"));
  if (!id) return { ok: false, error: "Missing event id." };
  if (!title) return { ok: false, error: "Title is required." };
  if (!startDate) return { ok: false, error: "Start date is required." };

  const allDay = bool(formData.get("all_day"));
  const startTime = allDay ? null : str(formData.get("start_time"));
  const endDate = str(formData.get("end_date")) ?? startDate;
  const endTime = allDay ? null : str(formData.get("end_time"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_event")
    .update({
      title,
      description: str(formData.get("description")),
      location: str(formData.get("location")),
      starts_at: toTimestamp(startDate, startTime),
      ends_at:
        endTime || str(formData.get("end_date"))
          ? toTimestamp(endDate, endTime)
          : null,
      all_day: allDay,
    })
    .eq("id", id)
    .eq("source", "custom");

  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

/** Delete a custom calendar event. */
export async function deleteCustomEvent(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing event id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_event")
    .delete()
    .eq("id", id)
    .eq("source", "custom");

  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

/**
 * Create a free-form day note (stored as a custom calendar_event with
 * category = 'note'). The note body doubles as the calendar title.
 */
export async function createNote(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const body = str(formData.get("note"));
  const date = str(formData.get("date"));
  if (!body) return { ok: false, error: "Note text is required." };
  if (!date) return { ok: false, error: "A date is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_event")
    .insert({
      source: "custom",
      title: body,
      starts_at: `${date}T00:00:00`,
      ends_at: null,
      all_day: true,
      category: "note",
      created_by: gate.current.authId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true, data: { id: data.id as string } };
}

/** Update the text and/or date of an existing day note. */
export async function updateNote(formData: FormData): Promise<ActionResult> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const id = str(formData.get("id"));
  const body = str(formData.get("note"));
  const date = str(formData.get("date"));
  if (!id) return { ok: false, error: "Missing note id." };
  if (!body) return { ok: false, error: "Note text is required." };
  if (!date) return { ok: false, error: "A date is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_event")
    .update({ title: body, starts_at: `${date}T00:00:00` })
    .eq("id", id)
    .eq("source", "custom")
    .eq("category", "note");

  if (error) return { ok: false, error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

/** Manually trigger a Google Calendar sync (same job the cron runs). */
export async function syncCalendarNow(): Promise<ActionResult> {
  const gate = await ensureCanEdit("calendar");
  if (!gate.ok) return gate;

  const res = await syncGoogleCalendar();
  revalidatePath("/calendar");
  if (!res.ok) return { ok: false, error: res.error ?? "Sync failed." };
  return { ok: true };
}
