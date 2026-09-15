import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  type CrmOrganization,
  MARKETING_VENDOR_CATEGORY,
} from "@/lib/crm/types";
import { OrgListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function MarketingVendorCrmPage() {
  const supabase = await createClient();
  const { data, error } = await fetchAllRows<CrmOrganization>((from, to) =>
    supabase
      .from("crm_organization")
      .select("*")
      .eq("category", MARKETING_VENDOR_CATEGORY)
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Marketing Vendors</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load marketing vendors: {error.message}
        </p>
      </div>
    );
  }

  return (
    <OrgListView
      organizations={(data ?? []) as CrmOrganization[]}
      title="Marketing Vendors"
      description="Printing, media, merchandise & other marketing services we purchase"
      icon="🧾"
      addHref="/crm/org/new?section=marketing-vendor"
      financial={false}
      enableQuickNote
    />
  );
}
