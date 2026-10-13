// Who may view / manage a Resources document, and whether a user still owes a
// signature. Mirrors the resource_document RLS policy and
// search_resource_content() in migration 0235 — change both together
// (scripts/security_rls_matrix.sql pins the database side on staging).

import { APP_ROLES, isEditorRole, type AppRole, type AppUser } from "../auth/permissions";

export interface DocumentAccessFields {
  /** NULL = everyone; [] = only the named viewers. */
  visible_roles: string[] | null;
}

export interface DocumentSignatureFields {
  require_signature: boolean;
  signature_from_version: number | null;
  current_version: number;
}

type AccessUser = Pick<AppUser, "id" | "role" | "is_active">;

/** HR / Manager, Executive, Admin and Owner create, edit and send documents. */
export function canManageDocuments(user: Pick<AppUser, "role" | "is_active">): boolean {
  return user.is_active && isEditorRole(user.role);
}

/**
 * Who the document is FOR — the access group that is notified and asked to
 * sign: everyone, or the chosen roles and people. HR / Managers can open every
 * document to manage it, but are only recipients when it is addressed to them.
 */
export function isDocumentRecipient(
  user: AccessUser,
  doc: DocumentAccessFields,
  viewerIds: ReadonlySet<string>,
): boolean {
  if (!user.is_active) return false;
  if (doc.visible_roles === null) return true;
  return doc.visible_roles.includes(user.role) || viewerIds.has(user.id);
}

/** Recipients plus HR / Manager and above (who manage every document). */
export function canViewDocument(
  user: AccessUser,
  doc: DocumentAccessFields,
  viewerIds: ReadonlySet<string>,
): boolean {
  return isDocumentRecipient(user, doc, viewerIds) || canManageDocuments(user);
}

/** Active recipients — the "access group" to notify and collect signatures from. */
export function documentAudience<U extends AccessUser>(
  doc: DocumentAccessFields,
  users: readonly U[],
  viewerIds: ReadonlySet<string>,
): U[] {
  return users.filter((u) => isDocumentRecipient(u, doc, viewerIds));
}

/** Keep only real roles, in canonical order; null stays null (everyone). */
export function normalizeVisibleRoles(roles: readonly string[] | null): AppRole[] | null {
  if (roles === null) return null;
  const set = new Set(roles);
  return APP_ROLES.filter((r) => set.has(r));
}

export type SignatureState = "not_required" | "signed" | "pending";

/**
 * A signature on `signature_from_version` or any later version is current; an
 * editor raises the baseline when everyone must re-sign.
 */
export function signatureState(
  doc: DocumentSignatureFields,
  signedVersions: readonly number[],
): SignatureState {
  if (!doc.require_signature || !doc.signature_from_version) return "not_required";
  return signedVersions.some((v) => v >= doc.signature_from_version!) ? "signed" : "pending";
}

/** Initials as typed: 1–10 letters, allowing ". ' -" and spaces after the first. */
export function normalizeInitials(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, " ");
  return /^[A-Za-z][A-Za-z.'\- ]{0,9}$/.test(v) ? v.toUpperCase() : null;
}

/** Today's date in the clinics' time zone, as YYYY-MM-DD. */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const ROLE_SHORT_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  executive: "Executive",
  manager: "HR / Manager",
  schedule_admin: "Schedule Admin",
  marketing_admin: "Marketing Admin",
  staff: "Staff",
};

/** "Everyone", "Staff, Schedule Admin + 2 people", "3 named people". */
export function describeAccess(visibleRoles: readonly string[] | null, viewerCount: number): string {
  if (visibleRoles === null) return "Everyone";
  const roles = normalizeVisibleRoles(visibleRoles) ?? [];
  const people = viewerCount === 1 ? "1 person" : `${viewerCount} people`;
  if (!roles.length) return viewerCount ? `Only ${people}` : "Nobody yet (HR / Managers can still open it)";
  const label = roles.map((r) => ROLE_SHORT_LABELS[r]).join(", ");
  return viewerCount ? `${label} + ${people}` : label;
}
