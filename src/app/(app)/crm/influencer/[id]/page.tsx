import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import type { CrmInfluencer } from "@/lib/crm/types";
import { InfluencerForm } from "./influencer-form";

export const dynamic = "force-dynamic";

export default async function InfluencerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
  const { data, error } = await supabase
    .from("marketing_influencers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load influencer: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const influencer = data as CrmInfluencer;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/crm/influencer"
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to Influencer CRM
      </Link>
      <InfluencerForm influencer={influencer} canEdit={canEdit} />
    </div>
  );
}
