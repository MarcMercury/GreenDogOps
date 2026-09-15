import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  type CrmOrganization,
  MARKETING_VENDOR_CATEGORY,
  NON_MED_CATEGORY,
  RESCUE_SUBTYPE,
} from "@/lib/crm/types";
import { OrgListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function SuppliesCrmPage() {
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
      // Marketing-category records are Non-Med Partners, marketing_vendor ones
      // are Marketing Vendors, and rescues have their own CRM.
      .or(`category.is.null,category.neq.${NON_MED_CATEGORY}`)
      .or(`category.is.null,category.neq.${MARKETING_VENDOR_CATEGORY}`)
      .or(`subtype.is.null,subtype.neq.${RESCUE_SUBTYPE}`)
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">
          Vendors &amp; Supplies
        </h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load vendors &amp; supplies: {error.message}
        </p>
      </div>
    );
  }

  return (
    <OrgListView
      organizations={(data ?? []) as CrmOrganization[]}
      title="Vendors & Supplies"
      description="Medical, facility & office vendors, suppliers and service providers"
      icon="📦"
      addHref="/crm/org/new?section=supplies"
      financial={false}
      enableQuickNote
    />
  );
}
