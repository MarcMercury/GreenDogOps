import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "../_components/ui";
import { AdminTabs } from "./admin-tabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gates every /admin route: owners & admins only.
  await requireAdmin();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Users, permissions, global controls, and system health."
      />
      <AdminTabs />
      {children}
    </div>
  );
}
