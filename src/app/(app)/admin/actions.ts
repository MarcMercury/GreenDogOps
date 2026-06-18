"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, recordAudit } from "@/lib/auth/session";
import {
  APP_ROLES,
  MODULES,
  type AppRole,
  type ModuleKey,
} from "@/lib/auth/permissions";

function parseRole(value: FormDataEntryValue | null): AppRole {
  const r = String(value ?? "");
  return (APP_ROLES as string[]).includes(r) ? (r as AppRole) : "staff";
}

function parseModuleAccess(form: FormData): Record<string, boolean> {
  const access: Record<string, boolean> = {};
  for (const m of MODULES) {
    const v = form.get(`module_${m.key}`);
    // Only store explicit overrides (checkbox present). Use "inherit" to skip.
    if (v === "allow") access[m.key as ModuleKey] = true;
    else if (v === "deny") access[m.key as ModuleKey] = false;
  }
  return access;
}

/** Grant a (shared) auth user access to Green Dog Ops. */
export async function grantAccess(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("auth_id") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!id) return;

  const admin = createAdminClient();
  const { data: authData } = await admin.auth.admin.getUserById(id);
  const authUser = authData?.user;
  if (!authUser?.email) return;

  const fullName =
    (authUser.user_metadata?.full_name as string | undefined) ?? null;

  await admin.from("app_user").upsert(
    {
      id,
      email: authUser.email,
      full_name: fullName,
      role,
      is_active: true,
      created_by: current.authId,
    },
    { onConflict: "id" },
  );

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "user.access_granted",
    entity: "app_user",
    entityId: id,
    summary: `Granted ${authUser.email} access as ${role}`,
  });

  revalidatePath("/admin/users");
}

/** Update an existing GDO user's role, status, and module access. */
export async function updateUser(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const role = parseRole(formData.get("role"));
  const isActive = formData.get("is_active") === "on";
  const fullName = String(formData.get("full_name") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const moduleAccess = parseModuleAccess(formData);

  // Guard: an owner cannot demote/deactivate themselves and lock everyone out.
  if (id === current.authId && (!isActive || role !== "owner")) {
    // Keep the current owner safe; ignore self-lockout attempts.
    revalidatePath(`/admin/users/${id}`);
    return;
  }

  const admin = createAdminClient();
  await admin
    .from("app_user")
    .update({
      role,
      is_active: isActive,
      full_name: fullName,
      title,
      notes,
      module_access: moduleAccess,
    })
    .eq("id", id);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "user.updated",
    entity: "app_user",
    entityId: id,
    summary: `Updated user ${fullName ?? id} (${role}${isActive ? "" : ", inactive"})`,
    metadata: { role, is_active: isActive, module_access: moduleAccess },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
}

/** Revoke a user's GDO access (soft — keeps the record + audit trail). */
export async function revokeAccess(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id || id === current.authId) return;

  const admin = createAdminClient();
  await admin.from("app_user").update({ is_active: false }).eq("id", id);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "user.access_revoked",
    entity: "app_user",
    entityId: id,
    summary: `Revoked access for user ${id}`,
  });

  revalidatePath("/admin/users");
}

/**
 * Keep the legacy flat setting `org.locations` in sync as a derived mirror of
 * the active location names. The canonical source of truth is the `location`
 * table (managed via Admin → Locations); this mirror exists only so any older
 * code path that still reads the setting stays consistent.
 */
async function syncOrgLocationsSetting(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data } = await admin
    .from("location")
    .select("name, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const names = (data ?? []).map((r) => (r as { name: string }).name);
  await admin
    .from("app_setting")
    .update({ value: names })
    .eq("key", "org.locations");
}

const LOCATION_TEXT_FIELDS = [
  "name",
  "display_name",
  "short_code",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "phone",
  "email",
  "map_url",
  "website_url",
  "notes",
] as const;

/** Create or update a clinic / mobile location (admin source of truth). */
export async function saveLocation(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();

  const values: Record<string, unknown> = {};
  for (const f of LOCATION_TEXT_FIELDS) {
    const v = String(formData.get(f) ?? "").trim();
    values[f] = v === "" ? null : v;
  }
  if (!values.name) return;

  const kind = String(formData.get("kind") ?? "clinic");
  values.kind = kind === "mobile" ? "mobile" : "clinic";
  values.color = String(formData.get("color") ?? "").trim() || "#64748b";
  values.sort_order = Number(formData.get("sort_order") ?? 0) || 0;
  values.is_active = formData.get("is_active") === "on";
  const parent = String(formData.get("parent_location_id") ?? "").trim();
  values.parent_location_id = parent === "" ? null : parent;

  const admin = createAdminClient();
  if (id) {
    await admin.from("location").update(values).eq("id", id);
  } else {
    await admin.from("location").insert(values);
  }
  await syncOrgLocationsSetting(admin);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: id ? "location.updated" : "location.created",
    entity: "location",
    entityId: id || undefined,
    summary: `${id ? "Updated" : "Added"} location “${values.name as string}”`,
  });

  revalidatePath("/admin/locations");
  revalidatePath("/schedule");
}

/** Toggle a location's active state (kept, never hard-deleted, for FK history). */
export async function setLocationActive(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const isActive = String(formData.get("is_active") ?? "") === "true";

  const admin = createAdminClient();
  await admin.from("location").update({ is_active: isActive }).eq("id", id);
  await syncOrgLocationsSetting(admin);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: isActive ? "location.activated" : "location.deactivated",
    entity: "location",
    entityId: id,
    summary: `${isActive ? "Activated" : "Deactivated"} location ${id}`,
  });

  revalidatePath("/admin/locations");
  revalidatePath("/schedule");
}

/** Persist global program settings (one form for all editable keys). */
export async function updateSettings(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const admin = createAdminClient();

  const entries: { key: string; value: unknown }[] = [];
  for (const [name, raw] of formData.entries()) {
    if (name.startsWith("settingarr_")) {
      const key = name.slice("settingarr_".length);
      const value = String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      entries.push({ key, value });
      continue;
    }
    if (!name.startsWith("setting_")) continue;
    const key = name.slice("setting_".length);
    const str = String(raw);
    let value: unknown = str;
    // booleans come through as a true/false select; coerce known JSON shapes.
    if (str === "true" || str === "false") value = str === "true";
    else if (str !== "" && /^-?\d+(\.\d+)?$/.test(str)) value = Number(str);
    entries.push({ key, value });
  }

  for (const e of entries) {
    await admin
      .from("app_setting")
      .update({ value: e.value, updated_by: current.authId })
      .eq("key", e.key);
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "settings.updated",
    entity: "app_setting",
    summary: `Updated ${entries.length} setting(s)`,
    metadata: { keys: entries.map((e) => e.key) },
  });

  revalidatePath("/admin/settings");
}

// ---------------------------------------------------------------------------
// Credential vault
// ---------------------------------------------------------------------------
const CREDENTIAL_FIELDS = [
  "category",
  "label",
  "service",
  "url",
  "username",
  "password",
  "account_number",
  "location",
  "contact_name",
  "contact_email",
  "contact_phone",
  "order_method",
  "payment_method",
  "status",
  "owner_scope",
  "notes",
] as const;

function collectCredential(form: FormData): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of CREDENTIAL_FIELDS) {
    const v = String(form.get(f) ?? "").trim();
    out[f] = v === "" ? null : v;
  }
  if (!out.category) out.category = "vendor";
  return out;
}

/** Create or update a credential. */
export async function saveCredential(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const values = collectCredential(formData);
  if (!values.label) return;

  const admin = createAdminClient();
  if (id) {
    await admin.from("credential").update(values).eq("id", id);
  } else {
    await admin
      .from("credential")
      .insert({ ...values, source: "manual", created_by: current.authId });
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: id ? "credential.updated" : "credential.created",
    entity: "credential",
    entityId: id || undefined,
    summary: `${id ? "Updated" : "Added"} credential “${values.label}”`,
  });

  revalidatePath("/admin/credentials");
}

/** Delete a credential. */
export async function deleteCredential(formData: FormData): Promise<void> {
  const current = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = createAdminClient();
  const { data } = await admin
    .from("credential")
    .select("label")
    .eq("id", id)
    .maybeSingle();
  await admin.from("credential").delete().eq("id", id);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "credential.deleted",
    entity: "credential",
    entityId: id,
    summary: `Deleted credential “${(data as { label?: string } | null)?.label ?? id}”`,
  });

  revalidatePath("/admin/credentials");
}
