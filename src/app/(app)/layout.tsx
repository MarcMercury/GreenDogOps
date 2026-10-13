import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthState, touchLastSeen } from "@/lib/auth/session";
import {
  accessibleModules,
  canAccessModule,
  moduleForPathname,
  PATHNAME_HEADER,
} from "@/lib/auth/permissions";
import { canUseViewAs } from "@/lib/auth/view-as";
import { AppShell } from "./_components/app-shell";
import { ModuleDenied } from "./_components/module-denied";
import { NoAccess } from "./_components/no-access";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getAuthState();

  if (state.kind === "anon") redirect("/login");
  if (state.kind === "mfa_challenge" || state.kind === "mfa_enroll") {
    redirect("/login/mfa");
  }
  if (state.kind === "not_gdo") {
    // Signed in but not a GDO user (auth.users is shared with EmployeeGMGDD).
    return <NoAccess email={state.email} />;
  }
  const current = state.current;

  // During a "View as" preview the viewer is still the real Owner.
  const viewer = current.viewAs?.realUser ?? current.appUser;
  const viewerEmail = current.viewAs?.realEmail ?? current.email;

  // Best-effort presence tracking (does not block render).
  void touchLastSeen(viewer.id);

  // Central module read-gate. Without this the sidebar hides a module a user
  // was denied, but the URL still renders it. Routes that are not module-scoped
  // (dashboard, shared CRM record pages) resolve to null and stay open.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const moduleKey = moduleForPathname(pathname);
  const denied = moduleKey !== null && !canAccessModule(current.appUser, moduleKey);

  return (
    <AppShell
      email={viewerEmail}
      role={viewer.role}
      modules={accessibleModules(current.appUser)}
      canViewAs={canUseViewAs(viewer)}
      viewAs={
        current.viewAs
          ? {
              kind: current.viewAs.kind,
              label: current.viewAs.label,
              email: current.viewAs.kind === "user" ? current.email : null,
              role: current.appUser.role,
            }
          : null
      }
    >
      {denied && moduleKey ? (
        <ModuleDenied moduleKey={moduleKey} role={current.appUser.role} />
      ) : (
        children
      )}
    </AppShell>
  );
}
