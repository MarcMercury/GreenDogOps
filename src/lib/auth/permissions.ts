// Roles, modules, and permission helpers for Green Dog Ops.
// auth.users is shared with EmployeeGMGDD; `app_user` is the GDO allow-list.

export type AppRole = "owner" | "admin" | "manager" | "staff" | "viewer";

export const APP_ROLES: AppRole[] = [
  "owner",
  "admin",
  "manager",
  "staff",
  "viewer",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  owner: "Full control, including billing and other owners.",
  admin: "Manage users, settings, and all modules.",
  manager: "Manage day-to-day operations across modules.",
  staff: "Use assigned modules; limited editing.",
  viewer: "Read-only access to assigned modules.",
};

// Module slugs that can be permissioned independently.
export type ModuleKey =
  | "dashboard"
  | "hr"
  | "ats"
  | "crm_referral"
  | "crm_vendor"
  | "crm_business"
  | "crm_student"
  | "crm_ce"
  | "schedule"
  | "policies"
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
  { key: "crm_referral", label: "Referral CRM", href: "/crm/referral" },
  { key: "crm_vendor", label: "Vendor CRM", href: "/crm/vendor" },
  { key: "crm_business", label: "Business CRM", href: "/crm/business" },
  { key: "crm_student", label: "Student CRM", href: "/crm/student" },
  { key: "crm_ce", label: "CE Leads", href: "/crm/ce" },
  { key: "schedule", label: "Scheduling", href: "/schedule" },
  { key: "policies", label: "Policies", href: "/policies" },
  { key: "admin", label: "Admin", href: "/admin" },
];

const ALL_MODULES = MODULES.map((m) => m.key);

// Default module access per role. Used when a user has no explicit override.
const ROLE_DEFAULT_MODULES: Record<AppRole, ModuleKey[]> = {
  owner: ALL_MODULES,
  admin: ALL_MODULES,
  manager: ALL_MODULES.filter((m) => m !== "admin"),
  staff: ["dashboard", "hr", "ats", "schedule", "policies"],
  viewer: ["dashboard", "policies"],
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
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isAdminRole(role: AppRole): boolean {
  return role === "owner" || role === "admin";
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
