import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, touchLastSeen } from "@/lib/auth/session";
import { accessibleModules } from "@/lib/auth/permissions";
import { AppShell } from "./_components/app-shell";
import { NoAccess } from "./_components/no-access";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = await getCurrentUser();

  if (!current) {
    // Distinguish "not signed in" from "signed in but not a GDO user"
    // (auth.users is shared with EmployeeGMGDD).
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    return <NoAccess email={user.email ?? null} />;
  }

  // Best-effort presence tracking (does not block render).
  void touchLastSeen(current.authId);

  return (
    <AppShell
      email={current.email}
      role={current.appUser.role}
      modules={accessibleModules(current.appUser)}
    >
      {children}
    </AppShell>
  );
}
