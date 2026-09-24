import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import type { CrmInfluencer } from "@/lib/crm/types";
import type { QrCode, QrLead } from "@/lib/marketing/qr";
import { InfluencerWorkspace } from "./influencer-workspace";

export const dynamic = "force-dynamic";

export default async function InfluencerCrmPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;

  const { data, error } = await fetchAllRows<CrmInfluencer>((from, to) =>
    supabase
      .from("marketing_influencers")
      .select("*")
      .order("contact_name", { ascending: true })
      .range(from, to),
  );

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Influencer CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load influencers: {error.message}
        </p>
      </div>
    );
  }

  // Every influencer's code plus the scans attributed to them.
  const [qrCodesRes, qrLeadsRes] = await Promise.all([
    supabase
      .from("qr_code")
      .select("*")
      .eq("code_type", "influencer")
      .order("created_at", { ascending: false }),
    supabase
      .from("qr_lead")
      .select("*")
      .not("influencer_id", "is", null)
      .order("scanned_at", { ascending: false })
      .limit(2000),
  ]);

  return (
    <InfluencerWorkspace
      influencers={(data ?? []) as CrmInfluencer[]}
      qrCodes={(qrCodesRes.data ?? []) as QrCode[]}
      qrLeads={(qrLeadsRes.data ?? []) as QrLead[]}
      canEdit={canEdit}
    />
  );
}
