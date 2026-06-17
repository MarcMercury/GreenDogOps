import { createClient } from "@/lib/supabase/server";
import type { CrmOrganization } from "@/lib/crm/types";
import { OrgListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function VendorCrmPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_organization")
    .select("*")
    .in("org_type", ["facility_resource", "med_ops"])
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Vendor CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load vendors: {error.message}
        </p>
      </div>
    );
  }

  return (
    <OrgListView
      organizations={(data ?? []) as CrmOrganization[]}
      title="Vendor CRM"
      description="Facility resources and medical-ops vendors"
      icon="🔧"
    />
  );
}
