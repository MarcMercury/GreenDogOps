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
