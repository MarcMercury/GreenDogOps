import { createAdminClient } from "@/lib/supabase/admin";
import { Panel } from "../_components";
import { CredentialsView } from "./credentials-view";
import type { Credential } from "@/lib/admin/credentials";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credential")
    .select("*")
    .order("category", { ascending: true })
    .order("label", { ascending: true });

  const credentials = (data ?? []) as Credential[];

  return (
    <Panel
      title="Credential vault"
      description={`${credentials.length} accounts, logins & vendor passwords. Owners & admins only — never share outside this view.`}
    >
      <CredentialsView credentials={credentials} />
    </Panel>
  );
}
