import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUser, ModuleKey } from "./permissions";
import { aalFromAccessToken, isMfaEnforced, mfaRequirement, roleRequiresMfa } from "./mfa";
import {
  isAdminRole,
  canAccessModule,
  canEditModule,
  canEditGeneral,
  canViewSensitiveHr,
} from "./permissions";

export interface CurrentUser {
  authId: string;
  email: string;
  appUser: AppUser;
}

export type AuthState =
  | { kind: "anon" }
  | { kind: "not_gdo"; email: string | null }
  | {
      kind: "mfa_challenge" | "mfa_enroll";
      current: CurrentUser;
      verifiedFactorIds: string[];
    }
  | { kind: "ok"; current: CurrentUser; verifiedFactorIds: string[]; aal: string | null };

/**
 * Resolve the request's authentication state: no session, a session that is
 * not an active GDO user, a GDO user who still owes a two-step code (or must
 * enroll), or fully signed in. Cached per request.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "anon" };

  const { data } = await supabase
    .from("app_user")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const appUser = data as AppUser | null;
  if (!appUser || !appUser.is_active) {
    return { kind: "not_gdo", email: user.email ?? null };
  }

  const current: CurrentUser = {
    authId: user.id,
    email: user.email ?? appUser.email,
    appUser,
  };

  // getUser() above validated this session's access token with the auth
  // server, and its factor list comes from the server — not the cookie.
  const verifiedFactorIds = (user.factors ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => f.id);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const aal = aalFromAccessToken(session?.access_token);

  const roleRequires = roleRequiresMfa(appUser.role);
  const requirement = mfaRequirement({
    hasVerifiedFactor: verifiedFactorIds.length > 0,
    aal,
    roleRequires,
    enforced: roleRequires && verifiedFactorIds.length === 0 ? await isMfaEnforced() : false,
  });
  if (requirement === "challenge") return { kind: "mfa_challenge", current, verifiedFactorIds };
  if (requirement === "enroll") return { kind: "mfa_enroll", current, verifiedFactorIds };
  return { kind: "ok", current, verifiedFactorIds, aal };
});

/**
 * Resolve the signed-in auth user AND their Green Dog Ops `app_user` row.
 * Returns null if there is no session, if the user is not an active GDO user
 * (auth.users is shared with EmployeeGMGDD, so a session alone is NOT
 * sufficient to access GDO), or if two-step verification is still pending.
 * Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const state = await getAuthState();
  return state.kind === "ok" ? state.current : null;
});

/** Require an active GDO user, else redirect to login (or the two-step page). */
export async function requireUser(): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.kind === "mfa_challenge" || state.kind === "mfa_enroll") {
    redirect("/login/mfa");
  }
  if (state.kind !== "ok") redirect("/login");
  return state.current;
}

/** Require an owner/admin, else redirect to the dashboard. */
export async function requireAdmin(): Promise<CurrentUser> {
  const current = await requireUser();
  if (!isAdminRole(current.appUser.role)) redirect("/");
  return current;
}

/**
 * Require a user who can *view* the Admin panel, else redirect to the
 * dashboard. Owners and admins can edit; executives (and anyone granted the
 * `admin` module via a per-user override) may view it read-only. Actual
 * mutations stay gated by requireAdmin(), so viewers cannot make changes.
 */
export async function requireAdminView(): Promise<CurrentUser> {
  const current = await requireUser();
  if (!canAccessModule(current.appUser, "admin")) redirect("/");
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
 * Gate for the sensitive HR-file records (reviews, discipline, assets,
 * onboarding/compliance, licenses, documents). Requires HR edit rights AND a
 * role that sees full HR files — matching the `hr_edit` RLS predicate (0227).
 */
export async function ensureCanEditSensitiveHr(): Promise<EditGate> {
  const gate = await ensureCanEdit("hr");
  if (!gate.ok) return gate;
  if (!canViewSensitiveHr(gate.current.appUser.role)) {
    return { ok: false, error: NO_EDIT_MESSAGE };
  }
  return gate;
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
