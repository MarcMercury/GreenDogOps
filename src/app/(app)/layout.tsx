import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthState, touchLastSeen } from "@/lib/auth/session";
import {
  accessibleModules,
  canAccessModule,
  canUseSmartReport,
  moduleForPathname,
  PATHNAME_HEADER,
} from "@/lib/auth/permissions";
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

  // Best-effort presence tracking (does not block render).
  void touchLastSeen(current.authId);

  // Central module read-gate. Without this the sidebar hides a module a user
  // was denied, but the URL still renders it. Routes that are not module-scoped
  // (dashboard, shared CRM record pages) resolve to null and stay open.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  const moduleKey = moduleForPathname(pathname);
  const denied = moduleKey !== null && !canAccessModule(current.appUser, moduleKey);

  return (
    <AppShell
      email={current.email}
      role={current.appUser.role}
      modules={accessibleModules(current.appUser)}
      canSmartReport={canUseSmartReport(current.appUser)}
    >
      {denied && moduleKey ? (
        <ModuleDenied moduleKey={moduleKey} role={current.appUser.role} />
      ) : (
        children
      )}
    </AppShell>
  );
}
