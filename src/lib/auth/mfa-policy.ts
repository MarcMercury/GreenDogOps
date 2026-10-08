import type { AppRole } from "./permissions";

/**
 * Two-step verification (TOTP) policy — pure functions, no I/O.
 *
 * - Anyone who has enrolled a verified factor must complete the code challenge
 *   (session AAL2) before using Green Dog Ops. The database enforces the same
 *   rule in greendogops.is_gdo_user() (migration 0227).
 * - When the Admin setting `security.require_mfa` is on, these roles must
 *   enroll before they can continue. It ships OFF.
 */
export const MFA_REQUIRED_ROLES: readonly AppRole[] = [
  "owner",
  "admin",
  "executive",
  "manager",
];

export function roleRequiresMfa(role: AppRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** The `aal` claim of a JWT (unverified decode — call only after getUser()). */
export function aalFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { aal?: unknown };
    return typeof payload.aal === "string" ? payload.aal : null;
  } catch {
    return null;
  }
}

export type MfaRequirement = "ok" | "challenge" | "enroll";

/** Pure decision used by the session resolver (unit-tested). */
export function mfaRequirement(input: {
  hasVerifiedFactor: boolean;
  aal: string | null;
  roleRequires: boolean;
  enforced: boolean;
}): MfaRequirement {
  if (input.hasVerifiedFactor) return input.aal === "aal2" ? "ok" : "challenge";
  if (input.roleRequires && input.enforced) return "enroll";
  return "ok";
}
