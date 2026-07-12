import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUser, ModuleKey } from "./permissions";
import { isAdminRole, canEditModule, canEditGeneral } from "./permissions";

export interface CurrentUser {
  authId: string;
  email: string;
  appUser: AppUser;
}

/**
 * Resolve the signed-in auth user AND their Green Dog Ops `app_user` row.
 * Returns null if there is no session, or if the user is not an active
 * GDO user (auth.users is shared with EmployeeGMGDD, so a session alone is
 * NOT sufficient to access GDO). Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("app_user")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const appUser = data as AppUser | null;
  if (!appUser || !appUser.is_active) return null;

  return { authId: user.id, email: user.email ?? appUser.email, appUser };
});

/** Require an active GDO user, else redirect to login. */
export async function requireUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return current;
}

/** Require an owner/admin, else redirect to the dashboard. */
export async function requireAdmin(): Promise<CurrentUser> {
  const current = await requireUser();
  if (!isAdminRole(current.appUser.role)) redirect("/");
  return current;
}

/** Discriminated result for edit-permission gates used inside server actions. */
export type EditGate =
  | { ok: true; current: CurrentUser }
  | { ok: false; error: string };

const NO_EDIT_MESSAGE =
  "You do not have permission to make changes here.";

/**
 * Gate a mutating server action by module edit permission. The failure shape
 * (`{ ok: false, error }`) is compatible with the action result types used
 * across the app, so callers can `return gate` directly on denial.
 */
export async function ensureCanEdit(moduleKey: ModuleKey): Promise<EditGate> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in." };
  if (!canEditModule(current.appUser, moduleKey)) {
    return { ok: false, error: NO_EDIT_MESSAGE };
  }
  return { ok: true, current };
}

/**
 * Gate a mutating server action that applies to a general (non-schedule)
 * module without a single fixed module key — e.g. the shared CRM actions.
 * Owner/Admin/Executive/Manager-HR may edit, as may Schedule Admins (who have
 * write access to every module they can view). Staff are read-only here.
 */
export async function ensureEditor(): Promise<EditGate> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in." };
  if (canEditGeneral(current.appUser)) {
    return { ok: true, current };
  }
  return { ok: false, error: NO_EDIT_MESSAGE };
}

/** Best-effort "last seen" touch — never blocks the request. */
export async function touchLastSeen(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("app_user")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
  } catch {
    // non-critical
  }
}

interface AuditEntry {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/** Append an entry to the audit log. Never throws. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // audit logging is best-effort
  }
}
