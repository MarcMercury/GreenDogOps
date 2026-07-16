import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import {
  type CrmOrganization,
  type CrmOrgVisit,
  RESCUE_SUBTYPE,
} from "@/lib/crm/types";
import { RescueCrm } from "./rescue-crm";

export const dynamic = "force-dynamic";

export default async function RescueCrmPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "crm_rescue") : false;

  const rescuesRes = await fetchAllRows<CrmOrganization>((from, to) =>
    supabase
      .from("crm_organization")
      .select("*")
      .eq("org_type", "marketing_partner")
      .eq("subtype", RESCUE_SUBTYPE)
      .order("name", { ascending: true })
      .range(from, to),
  );

  if (rescuesRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Rescue/Shelter CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load rescues: {rescuesRes.error.message}
        </p>
      </div>
    );
  }

  const rescues = rescuesRes.data ?? [];
  const orgIds = rescues.map((r) => r.id);

  // Visit / activity log for these rescues (chunk the id filter to stay within
  // URL length limits on large lists).
  const visits: CrmOrgVisit[] = [];
  if (orgIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < orgIds.length; i += CHUNK) {
      const slice = orgIds.slice(i, i + CHUNK);
      const { data } = await fetchAllRows<CrmOrgVisit>((from, to) =>
        supabase
          .from("crm_org_visit")
          .select("*")
          .in("org_id", slice)
          .order("visit_date", { ascending: false })
          .range(from, to),
      );
      if (data) visits.push(...data);
    }
    visits.sort((a, b) => (a.visit_date < b.visit_date ? 1 : -1));
  }

  const mapsApiKey =
    process.env.GOOGLE_MAPS_PUBLIC_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

  return (
    <RescueCrm
      rescues={rescues}
      visits={visits}
      canEdit={canEdit}
      mapsApiKey={mapsApiKey}
    />
  );
}
