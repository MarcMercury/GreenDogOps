"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type SignupResult = { ok: true } | { ok: false; error: string };

function clean(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Split a full name into first/last for the crm_contact record. */
function splitName(full: string): { first: string; last: string | null } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: full, last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * PUBLIC action — called from the unauthenticated CE sign-up form reached by
 * scanning an event's QR code. Uses the service-role client (bypasses RLS) to
 * create a CE lead and roster them onto the event. Because it is public, it
 * only ever touches CE data and validates its inputs strictly.
 */
export async function submitCeSignup(
  eventId: string,
  _prev: SignupResult | null,
  formData: FormData,
): Promise<SignupResult> {
  const name = clean(formData.get("name"));
  const email = clean(formData.get("email"));
  const phone = clean(formData.get("phone"));

  if (!name) return { ok: false, error: "Please enter your name." };
  if (!email && !phone) {
    return { ok: false, error: "Please enter an email or phone number." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const admin = createAdminClient();

  const { data: eventRow, error: evErr } = await admin
    .from("crm_ce_event")
    .select("id, name, event_date")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) return { ok: false, error: "Something went wrong. Please try again." };
  if (!eventRow) return { ok: false, error: "This event could not be found." };
  const event = eventRow as { id: string; name: string; event_date: string | null };

  // Reuse an existing CE lead with the same email to avoid duplicates from
  // repeat scans; otherwise create a new lead sourced from this event.
  let contactId: string | null = null;
  if (email) {
    const { data: existing } = await admin
      .from("crm_contact")
      .select("id")
      .eq("contact_type", "ce_attendee")
      .ilike("email", email)
      .maybeSingle();
    if (existing) contactId = (existing as { id: string }).id;
  }

  if (!contactId) {
    const { first, last } = splitName(name);
    const { data: inserted, error: insErr } = await admin
      .from("crm_contact")
      .insert({
        contact_type: "ce_attendee",
        first_name: first,
        last_name: last,
        full_name: name,
        email,
        phone,
        source: "ce_qr_signup",
        lead_source: event.name,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return { ok: false, error: "Could not submit. Please try again." };
    }
    contactId = (inserted as { id: string }).id;
  }

  // Roster onto the event (skip if already rostered from a previous scan).
  const { data: alreadyRostered } = await admin
    .from("crm_ce_attendance")
    .select("id")
    .eq("contact_id", contactId)
    .eq("ce_event_id", event.id)
    .maybeSingle();

  if (!alreadyRostered) {
    const { error: attErr } = await admin.from("crm_ce_attendance").insert({
      contact_id: contactId,
      ce_event_id: event.id,
      ce_name: event.name,
      ce_date: event.event_date,
    });
    if (attErr) return { ok: false, error: "Could not submit. Please try again." };
  }

  return { ok: true };
}
