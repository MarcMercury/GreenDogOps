import { requireAdminView } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/permissions";
import { PageHeader } from "../_components/ui";
import { AdminTabs } from "./admin-tabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gates every /admin route: owners & admins (edit) plus executives (view).
  const current = await requireAdminView();
  const canEdit = isAdminRole(current.appUser.role);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Users, permissions, global controls, and system health."
      />
      {!canEdit ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">View-only.</span> Your role can review
          the Admin panel but cannot make changes. Contact an Owner or Admin to
          edit users, settings, or permissions.
        </div>
      ) : null}
      <AdminTabs />
      {children}
    </div>
  );
}
