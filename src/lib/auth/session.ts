import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
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
  PATHNAME_HEADER,
} from "./permissions";
import {
  canUseViewAs,
  isPreviewGuardedRequest,
  METHOD_HEADER,
  parseViewAsTarget,
  roleViewLabel,
  roleViewUser,
  VIEW_AS_COOKIE,
  VIEW_AS_READ_ONLY_MESSAGE,
} from "./view-as";

/** Set when an Owner is previewing someone else's access ("View as"). */
export interface ViewAsInfo {
  kind: "user" | "role";
  /** The previewed user's name, or the role label. */
  label: string;
  /** The Owner who is actually signed in. */
  realUser: AppUser;
  realEmail: string;
}

export interface CurrentUser {
  authId: string;
  email: string;
  appUser: AppUser;
  /** Present only during a "View as" preview; `appUser` is then the previewed access. */
  viewAs?: ViewAsInfo | null;
}

/** Options for session helpers called from Server Actions or /api routes. */
export interface SessionOptions {
  /**
   * The caller is a pure read (no writes, no external side effects), so it may
   * run during a read-only "View as" preview with the previewed user's access.
   */
  allowPreview?: boolean;
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
 * Resolve the request's authentication state for the person actually signed
 * in: no session, a session that is not an active GDO user, a GDO user who
 * still owes a two-step code (or must enroll), or fully signed in. Ignores any
 * "View as" preview — use for the viewer's own account (two-step verification,
 * the View-as switcher). Cached per request.
 */
export const getRealAuthState = cache(async (): Promise<AuthState> => {
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
 * The request's effective authentication state: the real state, except that a
 * fully signed-in Owner with an active "View as" preview gets the previewed
 * access as `current` (with `current.viewAs` describing the real viewer).
 * Every permission check should use this. Cached per request.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const state = await getRealAuthState();
  if (state.kind !== "ok") return state;
  const current = await applyViewAs(state.current);
  return current === state.current ? state : { ...state, current };
});

async function applyViewAs(real: CurrentUser): Promise<CurrentUser> {
  if (!canUseViewAs(real.appUser)) return real;
  const target = parseViewAsTarget((await cookies()).get(VIEW_AS_COOKIE)?.value);
  if (!target) return real;
  const viewer = { realUser: real.appUser, realEmail: real.email };

  if (target.kind === "role") {
    return {
      ...real,
      appUser: roleViewUser(real.appUser, target.role),
      viewAs: { kind: "role", label: roleViewLabel(target.role), ...viewer },
    };
  }
  if (target.userId === real.appUser.id) return real;

  const { data } = await createAdminClient()
    .from("app_user")
    .select("*")
    .eq("id", target.userId)
    .maybeSingle();
  const appUser = data as AppUser | null;
  // A deactivated or deleted target silently falls back to the real user.
  if (!appUser || !appUser.is_active) return real;
  return {
    authId: appUser.id,
    email: appUser.email,
    appUser,
    viewAs: { kind: "user", label: appUser.full_name || appUser.email, ...viewer },
  };
}

/**
 * True when a "View as" preview must refuse this request: the caller has not
 * opted in as a pure read, and the request is a Server Action or /api call.
 * Page renders (GET) are always allowed so the preview can be browsed.
 */
async function previewRefuses(
  current: CurrentUser,
  options: SessionOptions | undefined,
): Promise<boolean> {
  if (!current.viewAs || options?.allowPreview) return false;
  const h = await headers();
  return isPreviewGuardedRequest({
    method: h.get(METHOD_HEADER),
    pathname: h.get(PATHNAME_HEADER),
  });
}

/**
 * Resolve the signed-in auth user AND their Green Dog Ops `app_user` row.
 * Returns null if there is no session, if the user is not an active GDO user
 * (auth.users is shared with EmployeeGMGDD, so a session alone is NOT
 * sufficient to access GDO), or if two-step verification is still pending.
 * Cached per request.
 */
export async function getCurrentUser(
  options?: SessionOptions,
): Promise<CurrentUser | null> {
  const state = await getAuthState();
  if (state.kind !== "ok") return null;
  if (await previewRefuses(state.current, options)) return null;
  return state.current;
}

/**
 * Require an active GDO user, else redirect to login (or the two-step page).
 * Throws during a read-only "View as" preview unless `allowPreview` is set.
 */
export async function requireUser(options?: SessionOptions): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.kind === "mfa_challenge" || state.kind === "mfa_enroll") {
    redirect("/login/mfa");
  }
  if (state.kind !== "ok") redirect("/login");
  if (await previewRefuses(state.current, options)) {
    throw new Error(VIEW_AS_READ_ONLY_MESSAGE);
  }
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

/** The signed-in user for an edit gate, with a clear message during a preview. */
async function currentForEdit(): Promise<EditGate> {
  const state = await getAuthState();
  if (state.kind !== "ok") return { ok: false, error: "You are not signed in." };
  if (await previewRefuses(state.current, undefined)) {
    return { ok: false, error: VIEW_AS_READ_ONLY_MESSAGE };
  }
  return { ok: true, current: state.current };
}

/**
 * Gate a mutating server action by module edit permission. The failure shape
 * (`{ ok: false, error }`) is compatible with the action result types used
 * across the app, so callers can `return gate` directly on denial.
 */
export async function ensureCanEdit(moduleKey: ModuleKey): Promise<EditGate> {
  const resolved = await currentForEdit();
  if (!resolved.ok) return resolved;
  const { current } = resolved;
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
  const resolved = await currentForEdit();
  if (!resolved.ok) return resolved;
  const { current } = resolved;
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
