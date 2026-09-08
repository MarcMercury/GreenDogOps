import {
  MODULES,
  ROLE_LABELS,
  type AppRole,
  type ModuleKey,
} from "@/lib/auth/permissions";

/**
 * Shown when an authorized Green Dog Ops user opens a module their role or
 * per-user override does not grant. Rendered by (app)/layout.tsx.
 */
export function ModuleDenied({
  moduleKey,
  role,
}: {
  moduleKey: ModuleKey;
  role: AppRole;
}) {
  const label = MODULES.find((m) => m.key === moduleKey)?.label ?? moduleKey;

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
        🔒
      </span>
      <h1 className="text-lg font-bold text-slate-900">{label} is restricted</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your access level ({ROLE_LABELS[role]}) does not include this module. Ask
        an Owner or Admin to grant it in Admin ▸ Users.
      </p>
    </div>
  );
}
