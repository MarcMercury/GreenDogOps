"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { canEditModule, isAdminRole } from "@/lib/auth/permissions";
import type { InitiativeLink } from "@/lib/marketing/types";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------
function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function int(v: FormDataEntryValue | null): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true";
}

// Every action here mutates marketing data, so it requires *edit* rights on the
// Marketing Management module. Read-only roles are redirected away.
async function requireMarketingEditor() {
  const current = await requireUser();
  if (!canEditModule(current.appUser, "marketing")) redirect("/");
  return current;
}

// Budget data is sensitive — only owners/admins may view OR mutate it.
async function requireMarketingAdmin() {
  const current = await requireUser();
  if (!isAdminRole(current.appUser.role)) redirect("/");
  return current;
}

function done(message: string): ActionResult {
  revalidatePath("/marketing");
  return { ok: true, message };
}

// ===========================================================================
// Goals
// ===========================================================================
export async function saveGoal(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    title: str(formData.get("title")) ?? "Untitled goal",
    category: str(formData.get("category")),
    metric_unit: str(formData.get("metric_unit")),
    target_value: num(formData.get("target_value")),
    current_value: num(formData.get("current_value")),
    period: str(formData.get("period")),
    notes: str(formData.get("notes")),
    is_active: formData.get("is_active") == null ? true : bool(formData.get("is_active")),
  };
  const { error } = id
    ? await supabase.from("marketing_goal").update(patch).eq("id", id)
    : await supabase.from("marketing_goal").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Goal updated." : "Goal added.");
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("marketing_goal").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Goal deleted.");
}

// ===========================================================================
// Initiatives
// ===========================================================================
function parseLinks(formData: FormData): InitiativeLink[] {
  const labels = formData.getAll("link_label").map((v) => String(v).trim());
  const urls = formData.getAll("link_url").map((v) => String(v).trim());
  const out: InitiativeLink[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    out.push({ label: labels[i] || url, url });
  }
  return out;
}

export async function saveInitiative(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    title: str(formData.get("title")) ?? "Untitled initiative",
    category: str(formData.get("category")) ?? "other",
    status: str(formData.get("status")) ?? "planned",
    priority: str(formData.get("priority")) ?? "medium",
    owner_name: str(formData.get("owner_name")),
    partner_name: str(formData.get("partner_name")),
    next_action: str(formData.get("next_action")),
    due_date: str(formData.get("due_date")),
    notes: str(formData.get("notes")),
    links: parseLinks(formData),
  };
  const { error } = id
    ? await supabase.from("marketing_initiative").update(patch).eq("id", id)
    : await supabase.from("marketing_initiative").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Initiative updated." : "Initiative added.");
}

export async function updateInitiativeStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_initiative")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Status updated.");
}

export async function deleteInitiative(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_initiative")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Initiative deleted.");
}

// ===========================================================================
// Events
// ===========================================================================
export async function saveEvent(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")) ?? "Untitled event",
    event_type: str(formData.get("event_type")) ?? "third_party",
    status: str(formData.get("status")) ?? "researching",
    starts_on: str(formData.get("starts_on")),
    ends_on: str(formData.get("ends_on")),
    location: str(formData.get("location")),
    clinic_served: str(formData.get("clinic_served")),
    owner_name: str(formData.get("owner_name")),
    cost: num(formData.get("cost")),
    staff_needed: str(formData.get("staff_needed")),
    description: str(formData.get("description")),
    attendees: int(formData.get("attendees")),
    signups: int(formData.get("signups")),
    appointments: int(formData.get("appointments")),
    products_sold: str(formData.get("products_sold")),
    redemption_codes: str(formData.get("redemption_codes")),
    coupons_redeemed: int(formData.get("coupons_redeemed")),
    client_spend: num(formData.get("client_spend")),
    feedback: str(formData.get("feedback")),
    // Planning / promotion
    planning_phase: str(formData.get("planning_phase")),
    staff: str(formData.get("staff")),
    supplies: str(formData.get("supplies")),
    promo_channels: str(formData.get("promo_channels")),
    landing_url: str(formData.get("landing_url")),
    rsvp_url: str(formData.get("rsvp_url")),
    source_id: str(formData.get("source_id")),
    checklist: parseChecklist(formData),
  };
  const { error } = id
    ? await supabase.from("marketing_event").update(patch).eq("id", id)
    : await supabase.from("marketing_event").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Event updated." : "Event added.");
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase.from("marketing_event").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Event deleted.");
}

// ===========================================================================
// Event sources & attendees (events-management workflow)
// ===========================================================================
function parseChecklist(formData: FormData): { label: string; done: boolean }[] {
  const labels = formData.getAll("check_label").map((v) => String(v).trim());
  const done = formData.getAll("check_done").map((v) => String(v));
  return labels
    .map((label, i) => ({ label, done: done[i] === "true" }))
    .filter((c) => c.label);
}

export async function saveEventSource(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")) ?? "Untitled source",
    url: str(formData.get("url")),
    region: str(formData.get("region")),
    membership_cost: str(formData.get("membership_cost")),
    cadence: str(formData.get("cadence")) ?? "monthly",
    active: formData.get("active") == null ? true : bool(formData.get("active")),
    notes: str(formData.get("notes")),
  };
  const { error } = id
    ? await supabase.from("marketing_event_source").update(patch).eq("id", id)
    : await supabase.from("marketing_event_source").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Source updated." : "Source added.");
}

export async function markSourceChecked(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("marketing_event_source")
    .update({ last_checked_on: today })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Marked checked today.");
}

export async function deleteEventSource(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_event_source")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Source deleted.");
}

/** Create a scheduled event seeded from an event source. */
export async function createEventFromSource(
  sourceId: string,
  name: string,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { data: source } = await supabase
    .from("marketing_event_source")
    .select("region, name")
    .eq("id", sourceId)
    .maybeSingle();
  const { error } = await supabase.from("marketing_event").insert({
    name: name || `Event from ${source?.name ?? "source"}`,
    event_type: "third_party",
    status: "researching",
    planning_phase: "researching",
    location: source?.region ?? null,
    source_id: sourceId,
  });
  if (error) return { ok: false, error: error.message };
  return done("Event created from source.");
}

export async function saveAttendee(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const eventId = str(formData.get("event_id"));
  if (!eventId) return { ok: false, error: "Missing event." };
  const patch = {
    event_id: eventId,
    name: str(formData.get("name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    attendee_type: str(formData.get("attendee_type")) ?? "lead",
    is_new_client: bool(formData.get("is_new_client")),
    notes: str(formData.get("notes")),
  };
  const { error } = id
    ? await supabase.from("marketing_event_attendee").update(patch).eq("id", id)
    : await supabase.from("marketing_event_attendee").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Attendee updated." : "Attendee added.");
}

export async function deleteAttendee(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_event_attendee")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Attendee removed.");
}

// ===========================================================================
// Budget
// ===========================================================================
export async function saveBudgetPeriod(formData: FormData): Promise<ActionResult> {
  await requireMarketingAdmin();
  const supabase = await createClient();
  const year = int(formData.get("year"));
  if (year == null) return { ok: false, error: "Year is required." };
  const patch = {
    year,
    total_budget: num(formData.get("total_budget")) ?? 0,
    notes: str(formData.get("notes")),
  };
  const { error } = await supabase
    .from("marketing_budget_period")
    .upsert(patch, { onConflict: "year" });
  if (error) return { ok: false, error: error.message };
  return done("Budget updated.");
}

export async function saveBudgetEntry(formData: FormData): Promise<ActionResult> {
  await requireMarketingAdmin();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    entry_date: str(formData.get("entry_date")) ?? new Date().toISOString().slice(0, 10),
    category: str(formData.get("category")),
    business: str(formData.get("business")),
    description: str(formData.get("description")),
    amount: num(formData.get("amount")) ?? 0,
    paid_by: str(formData.get("paid_by")),
    payment_method: str(formData.get("payment_method")),
    status: str(formData.get("status")) ?? "paid",
    receipt_submitted: bool(formData.get("receipt_submitted")),
    notes: str(formData.get("notes")),
  };
  const { error } = id
    ? await supabase.from("marketing_budget_entry").update(patch).eq("id", id)
    : await supabase.from("marketing_budget_entry").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Spend entry updated." : "Spend entry added.");
}

export async function deleteBudgetEntry(id: string): Promise<ActionResult> {
  await requireMarketingAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_budget_entry")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Spend entry deleted.");
}

// ===========================================================================
// Resources
// ===========================================================================
export async function saveResource(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")) ?? "Untitled resource",
    category: str(formData.get("category")) ?? "tool",
    url: str(formData.get("url")),
    description: str(formData.get("description")),
    owner_name: str(formData.get("owner_name")),
    credential_note: str(formData.get("credential_note")),
  };
  const { error } = id
    ? await supabase.from("marketing_resource").update(patch).eq("id", id)
    : await supabase.from("marketing_resource").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Resource updated." : "Resource added.");
}

export async function deleteResource(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_resource")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Resource deleted.");
}

// ===========================================================================
// Promotions
// ===========================================================================
export async function savePromotion(formData: FormData): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const patch = {
    name: str(formData.get("name")) ?? "Untitled promotion",
    placement: str(formData.get("placement")),
    status: str(formData.get("status")) ?? "active",
    promo_type: str(formData.get("promo_type")) ?? "standard",
    duration_text: str(formData.get("duration_text")),
    discount_text: str(formData.get("discount_text")),
    discount_amount: num(formData.get("discount_amount")),
    product_code: str(formData.get("product_code")),
    ezyvet_line_item: str(formData.get("ezyvet_line_item")),
    how_to_redeem: str(formData.get("how_to_redeem")),
    promo_url: str(formData.get("promo_url")),
    booking_url: str(formData.get("booking_url")),
    rules: str(formData.get("rules")),
    notes: str(formData.get("notes")),
  };
  const { error } = id
    ? await supabase.from("marketing_promotion").update(patch).eq("id", id)
    : await supabase.from("marketing_promotion").insert(patch);
  if (error) return { ok: false, error: error.message };
  return done(id ? "Promotion updated." : "Promotion added.");
}

export async function deletePromotion(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_promotion")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Promotion deleted.");
}

// ===========================================================================
// Marketing Tree nodes
// ===========================================================================
/** Append a row to the marketing activity feed (best-effort; never throws). */
async function logActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entry: { kind: string; entity_id?: string | null; title: string; detail?: string | null; actor?: string | null },
): Promise<void> {
  try {
    await supabase.from("marketing_activity").insert({
      kind: entry.kind,
      entity_type: "node",
      entity_id: entry.entity_id ?? null,
      title: entry.title,
      detail: entry.detail ?? null,
      actor: entry.actor ?? null,
    });
  } catch {
    /* activity logging is best-effort */
  }
}

export async function saveTreeNode(formData: FormData): Promise<ActionResult> {
  const current = await requireMarketingEditor();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const actor = current.appUser.full_name || current.email;
  const patch = {
    label: str(formData.get("label")) ?? "Untitled node",
    zone: str(formData.get("zone")) ?? "canopy",
    parent_id: str(formData.get("parent_id")),
    status: str(formData.get("status")) ?? "active",
    priority: str(formData.get("priority")) ?? "medium",
    owner_person_id: str(formData.get("owner_person_id")),
    due_date: str(formData.get("due_date")),
    summary: str(formData.get("summary")),
    budget_amount: num(formData.get("budget_amount")),
    budget_spent: num(formData.get("budget_spent")),
    budget_notes: str(formData.get("budget_notes")),
    links: parseLinks(formData),
  };
  const { error } = id
    ? await supabase.from("marketing_tree_node").update(patch).eq("id", id)
    : await supabase.from("marketing_tree_node").insert(patch);
  if (error) return { ok: false, error: error.message };
  await logActivity(supabase, {
    kind: id ? "node_saved" : "node_created",
    entity_id: id,
    title: patch.label,
    detail: id ? "Node updated" : "Node created",
    actor,
  });
  return done(id ? "Node updated." : "Node added.");
}

/** "Updated" button — stamps last_handled_at and logs it to the activity feed. */
export async function markNodeHandled(
  id: string,
  label: string,
): Promise<ActionResult> {
  const current = await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_tree_node")
    .update({ last_handled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity(supabase, {
    kind: "node_handled",
    entity_id: id,
    title: label,
    detail: "Marked handled",
    actor: current.appUser.full_name || current.email,
  });
  return done("Marked as handled.");
}

export async function setTreeNodeStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_tree_node")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done(status === "archived" ? "Node archived." : "Status updated.");
}

export async function deleteTreeNode(id: string): Promise<ActionResult> {
  await requireMarketingEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("marketing_tree_node")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return done("Node deleted.");
}
