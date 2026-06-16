import { createClient } from "@/lib/supabase/server";
import type { CrmOrganization, CrmContact } from "@/lib/crm/types";
import { CrmExplorer } from "./crm-explorer";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const supabase = await createClient();

  const [orgRes, contactRes] = await Promise.all([
    supabase
      .from("crm_organization")
      .select("*")
      .order("name", { ascending: true }),
    supabase
      .from("crm_contact")
      .select("*")
      .order("last_name", { ascending: true }),
  ]);

  if (orgRes.error || contactRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load CRM: {orgRes.error?.message ?? contactRes.error?.message}
        </p>
      </div>
    );
  }

  return (
    <CrmExplorer
      organizations={(orgRes.data ?? []) as CrmOrganization[]}
      contacts={(contactRes.data ?? []) as CrmContact[]}
    />
  );
}
