import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailTemplate } from "@/lib/crm/email-templates";
import { TemplatesView } from "./templates-view";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_template")
    .select("*")
    .order("category")
    .order("name");

  const templates = (data ?? []) as EmailTemplate[];

  return <TemplatesView templates={templates} />;
}
