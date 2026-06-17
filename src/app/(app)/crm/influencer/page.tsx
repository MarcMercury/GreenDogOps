import { createClient } from "@/lib/supabase/server";
import type { CrmInfluencer } from "@/lib/crm/types";
import { InfluencerListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function InfluencerCrmPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("marketing_influencers")
    .select("*")
    .order("contact_name", { ascending: true })
    .limit(2000);

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

  return <InfluencerListView influencers={(data ?? []) as CrmInfluencer[]} />;
}
