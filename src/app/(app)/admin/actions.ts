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
 * Reconcile the canonical `location` table against the admin Settings list.
 * Settings (`org.locations`) is the single source of truth for clinic
 * locations; the schedule module reads from `location` (it needs stable IDs),
 * so we mirror the Settings names here on every save:
 *   - names in Settings are upserted as active, ordered by position;
 *   - locations missing from Settings are soft-deactivated (rows are kept so
 *     historical schedule assignments keep their foreign keys).
 */
async function reconcileLocations(
  admin: ReturnType<typeof createAdminClient>,
  names: string[],
): Promise<void> {
  const wanted = names.map((n) => n.trim()).filter(Boolean);
  const wantedLower = new Set(wanted.map((n) => n.toLowerCase()));

  const { data: existing } = await admin
    .from("location")
    .select("id, name, is_active, sort_order");
  const rows = (existing ?? []) as {
    id: string;
    name: string;
    is_active: boolean;
    sort_order: number | null;
  }[];

  // Deactivate any location no longer present in Settings.
  for (const row of rows) {
    if (!wantedLower.has(row.name.toLowerCase()) && row.is_active) {
      await admin
        .from("location")
        .update({ is_active: false })
        .eq("id", row.id);
    }
  }

  // Activate / insert each Settings location, preserving order.
  for (let i = 0; i < wanted.length; i++) {
    const name = wanted[i];
    const match = rows.find(
      (r) => r.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      await admin
        .from("location")
        .update({ is_active: true, sort_order: i * 10 })
        .eq("id", match.id);
    } else {
      await admin
        .from("location")
        .insert({ name, is_active: true, sort_order: i * 10 });
    }
  }
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

  // Settings drives the canonical location list used by the scheduler.
  const locEntry = entries.find((e) => e.key === "org.locations");
  if (locEntry && Array.isArray(locEntry.value)) {
    await reconcileLocations(admin, locEntry.value as string[]);
    revalidatePath("/schedule");
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
