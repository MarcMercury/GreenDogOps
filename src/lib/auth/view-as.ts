// "View as" — lets an Owner preview the app with another user's (or a role's)
// access without signing out. Pure helpers only; the request wiring lives in
// session.ts (resolution + read-only guard), proxy.ts (method header), and
// app/api/view-as/route.ts (start / stop).
//
// Invariants:
// - Only the REAL signed-in user's role decides whether a preview applies, and
//   it is re-checked on every request — the cookie alone grants nothing.
// - A preview is read-only: server actions and /api requests are refused by the
//   session helpers unless a call site explicitly opts in as a pure read.
// - Switching back never depends on the previewed user's access.

import type { AppRole, AppUser } from "./permissions";
import { APP_ROLES, ROLE_LABELS } from "./permissions";

export const VIEW_AS_COOKIE = "gdo_view_as";
/** Previews expire on their own so a forgotten one cannot linger for days. */
export const VIEW_AS_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Request header the proxy stamps with the HTTP method. Always overwritten by
 * the proxy, so an inbound value cannot be spoofed.
 */
export const METHOD_HEADER = "x-gdo-method";

export const VIEW_AS_READ_ONLY_MESSAGE =
  "You're previewing another user's access, which is read-only. Switch back to your own view to make changes.";

/** A previewable user, as listed by GET /api/view-as. */
export interface ViewAsUserOption {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  role: AppRole;
}

export type ViewAsTarget =
  | { kind: "user"; userId: string }
  | { kind: "role"; role: AppRole };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles that can be previewed with their default access. Owner is the viewer's own role. */
export const PREVIEWABLE_ROLES: AppRole[] = APP_ROLES.filter((r) => r !== "owner");

/** Only active Owners may preview other users' access. */
export function canUseViewAs(real: Pick<AppUser, "role" | "is_active">): boolean {
  return real.is_active && real.role === "owner";
}

/** Parse the cookie / form value: `user:<uuid>` or `role:<role>`. Anything else is null. */
export function parseViewAsTarget(value: string | null | undefined): ViewAsTarget | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep < 0) return null;
  const kind = value.slice(0, sep);
  const rest = value.slice(sep + 1);
  if (kind === "user" && UUID_RE.test(rest)) {
    return { kind: "user", userId: rest.toLowerCase() };
  }
  if (kind === "role" && (PREVIEWABLE_ROLES as string[]).includes(rest)) {
    return { kind: "role", role: rest as AppRole };
  }
  return null;
}

export function serializeViewAsTarget(target: ViewAsTarget): string {
  return target.kind === "user" ? `user:${target.userId}` : `role:${target.role}`;
}

/**
 * A role preview keeps the viewer's own identity (id, person) but swaps in the
 * role and drops per-user module overrides, so it shows that role's defaults.
 */
export function roleViewUser(real: AppUser, role: AppRole): AppUser {
  return { ...real, role, module_access: {} };
}

export function roleViewLabel(role: AppRole): string {
  return `${ROLE_LABELS[role]} (role defaults)`;
}

/**
 * Does this request run a mutation-capable code path (a Server Action POST or
 * any /api route)? During a preview those are refused unless opted in. A
 * missing method header is treated as mutating — fail closed.
 */
export function isPreviewGuardedRequest(req: {
  method: string | null;
  pathname: string | null;
}): boolean {
  const method = req.method?.toUpperCase() ?? null;
  if (method !== "GET" && method !== "HEAD") return true;
  return (req.pathname ?? "").startsWith("/api/");
}

/**
 * Only same-site relative paths, so the switcher cannot be used as an open
 * redirect. Whitespace and control characters are refused because URL parsing
 * strips them (`/\t/evil.example` would otherwise become `//evil.example`).
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    return "/";
  }
  return value;
}
