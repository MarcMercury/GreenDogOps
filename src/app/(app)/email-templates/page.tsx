import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import type { EmailTemplate } from "@/lib/crm/email-templates";
import { TemplatesView } from "./templates-view";

export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage() {
  // Schedule Admins and up may manage email templates; everyone else is out.
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (!canAccessModule(current.appUser, "email_templates")) redirect("/");

  const admin = createAdminClient();
  const { data } = await admin
    .from("email_template")
    .select("*")
    .order("category")
    .order("name");

  const templates = (data ?? []) as EmailTemplate[];

  return (
    <div className="mx-auto max-w-6xl">
      <TemplatesView templates={templates} />
    </div>
  );
}
