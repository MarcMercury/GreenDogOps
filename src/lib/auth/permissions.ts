// Roles, modules, and permission helpers for Green Dog Ops.
// auth.users is shared with EmployeeGMGDD; `app_user` is the GDO allow-list.

export type AppRole =
  | "owner"
  | "admin"
  | "executive"
  | "manager"
  | "schedule_admin"
  | "staff";

export const APP_ROLES: AppRole[] = [
  "owner",
  "admin",
  "executive",
  "manager",
  "schedule_admin",
  "staff",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  executive: "Executive",
  manager: "Manager/HR",
  schedule_admin: "Schedule Admin",
  staff: "Staff",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  owner: "Full control, including billing, other owners, and the Admin panel.",
  admin: "Full control of users, settings, and every module.",
  executive:
    "View and edit every module except the Admin panel; can view all compensation.",
  manager:
    "Manage and edit everything except the Admin panel; can view all compensation.",
  schedule_admin:
    "Edit every module they can see (Schedule, CRM, HR, ATS, Resources, etc.); no Admin panel and cannot view all compensation.",
  staff:
    "Read-only access to everything except the Admin panel; sees only their own compensation.",
};

// Module slugs that can be permissioned independently.
export type ModuleKey =
  | "dashboard"
  | "hr"
  | "ats"
  | "marketing"
  | "crm_referral"
  | "crm_vendor"
  | "crm_rescue"
  | "crm_business"
  | "crm_student"
  | "crm_ce"
  | "crm_influencer"
  | "reporting"
  | "emp_reporting"
  | "ezyvet"
  | "planning"
  | "schedule"
  | "calendar"
  | "resources"
  | "admin";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  href: string;
}

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "hr", label: "HR / Roster", href: "/hr" },
  { key: "ats", label: "Recruiting (ATS)", href: "/ats" },
  { key: "marketing", label: "Marketing Management", href: "/marketing" },
  { key: "crm_referral", label: "Referral CRM", href: "/crm/referral" },
  { key: "crm_vendor", label: "Vendor & Partner CRM", href: "/crm/vendor" },
  { key: "crm_rescue", label: "Rescue/Shelter CRM", href: "/crm/rescue" },
  { key: "crm_business", label: "Business CRM (merged → Vendor & Partner)", href: "/crm/vendor" },
  { key: "crm_student", label: "Student CRM", href: "/crm/student" },
  { key: "crm_ce", label: "CE Leads/Events", href: "/crm/ce" },
  { key: "crm_influencer", label: "Influencer CRM", href: "/crm/influencer" },
  { key: "ezyvet", label: "ezyVet CRM", href: "/ezyvet" },
  { key: "reporting", label: "Reporting", href: "/reporting" },
  { key: "emp_reporting", label: "Emp Reporting", href: "/emp-reporting" },
  { key: "planning", label: "Planning Guides", href: "/planning" },
  { key: "schedule", label: "Scheduling", href: "/schedule" },
  { key: "calendar", label: "Calendar", href: "/calendar" },
  { key: "resources", label: "Resources", href: "/resources" },
  { key: "admin", label: "Admin", href: "/admin" },
];

const ALL_MODULES = MODULES.map((m) => m.key);

// Modules only Owners/Admins can see by default. The Admin panel and the
// Biz Dev "Reporting" / "Emp Reporting" pages are admin-only; an admin can
// still grant them to a specific user via a per-user module_access override.
// Emp Reporting exposes payroll/compensation, so it is admin-only.
const ADMIN_ONLY_MODULES: ModuleKey[] = [
  "admin",
  "reporting",
  "emp_reporting",
];

// Default module access per role. Used when a user has no explicit override.
// Everyone except owners/admins is locked out of admin-only modules. Managers,
// schedule admins, and staff can all *see* every other module; what differs is
// whether they can edit (see canEditModule) and view compensation.
const NON_ADMIN_MODULES = ALL_MODULES.filter(
  (m) => !ADMIN_ONLY_MODULES.includes(m),
);
// Executives see and edit everything except the Admin panel — including the
// admin-only Reporting / Emp Reporting pages that other non-admins can't see.
const EXECUTIVE_MODULES = ALL_MODULES.filter((m) => m !== "admin");
const ROLE_DEFAULT_MODULES: Record<AppRole, ModuleKey[]> = {
  owner: ALL_MODULES,
  admin: ALL_MODULES,
  executive: EXECUTIVE_MODULES,
  manager: NON_ADMIN_MODULES,
  schedule_admin: NON_ADMIN_MODULES,
  staff: NON_ADMIN_MODULES,
};

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  role: AppRole;
  is_active: boolean;
  module_access: Record<string, boolean>;
  notes: string | null;
  person_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isAdminRole(role: AppRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Roles that may edit general (non-schedule) modules: Owner, Admin, Executive,
 * and Manager/HR. Staff and Schedule Admins are read-only outside the Schedule.
 */
export function isEditorRole(role: AppRole): boolean {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "executive" ||
    role === "manager"
  );
}

/**
 * Can this user make edits within the given module?
 * - owner/admin/executive/manager: edit any module they can access.
 * - schedule_admin: edit any module they can access (i.e. every non-admin
 *   module, including all CRM pages) — they have write access everywhere they
 *   have a view. They still cannot reach the Admin panel or view all
 *   compensation (that remains gated by isEditorRole).
 * - staff: read-only everywhere.
 */
export function canEditModule(user: AppUser, key: ModuleKey): boolean {
  if (!canAccessModule(user, key)) return false;
  if (isEditorRole(user.role)) return true;
  if (user.role === "schedule_admin") return true;
  return false;
}

/**
 * Can this user edit "general" (non-admin) modules that don't gate on a single
 * fixed module key — e.g. the shared CRM and Resources surfaces? This is the
 * write-side counterpart to isEditorRole, additionally including Schedule
 * Admins (who now have write access to every module they can view). Kept
 * separate from isEditorRole so it does NOT grant compensation visibility.
 */
export function canEditGeneral(user: AppUser): boolean {
  return isEditorRole(user.role) || user.role === "schedule_admin";
}

/** Roles allowed to view every employee's compensation/benefits data. */
export function canViewAllCompensation(role: AppRole): boolean {
  return isEditorRole(role);
}

/** Resolve effective module access: per-user overrides win over role defaults. */
export function canAccessModule(user: AppUser, key: ModuleKey): boolean {
  if (!user.is_active) return false;
  const override = user.module_access?.[key];
  if (typeof override === "boolean") return override;
  return ROLE_DEFAULT_MODULES[user.role].includes(key);
}

/** The set of module keys a user can access. */
export function accessibleModules(user: AppUser): ModuleKey[] {
  return ALL_MODULES.filter((k) => canAccessModule(user, k));
}

export function roleDefaultModules(role: AppRole): ModuleKey[] {
  return ROLE_DEFAULT_MODULES[role];
}
