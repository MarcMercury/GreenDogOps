import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { CrmOrganization } from "@/lib/crm/types";
import { OrgListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function VendorCrmPage() {
  const supabase = await createClient();
  const { data, error } = await fetchAllRows<CrmOrganization>((from, to) =>
    supabase
      .from("crm_organization")
      .select("*")
      .in("org_type", [
        "marketing_partner",
        "facility_resource",
        "med_ops",
        "office_marketing",
      ])
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">
          Vendor &amp; Partner CRM
        </h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load vendors &amp; partners: {error.message}
        </p>
      </div>
    );
  }

  return (
    <OrgListView
      organizations={(data ?? []) as CrmOrganization[]}
      title="Vendor & Partner CRM"
      description="Vendors, suppliers & business partners in one directory"
      icon="🤝"
      addHref="/crm/org/new?section=vendor"
      financial={false}
      enableQuickNote
    />
  );
}
