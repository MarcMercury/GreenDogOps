import { createClient } from "@/lib/supabase/server";
import type { CrmOrganization } from "@/lib/crm/types";
import { OrgListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function ReferralCrmPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_organization")
    .select("*")
    .eq("org_type", "referral_clinic")
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Referral CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load referral clinics: {error.message}
        </p>
      </div>
    );
  }

  return (
    <OrgListView
      organizations={(data ?? []) as CrmOrganization[]}
      title="Referral CRM"
      description="Referring medical clinics & hospitals"
      icon="🏥"
    />
  );
}
