import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import { InfluencerForm } from "../[id]/influencer-form";

export const dynamic = "force-dynamic";

export default async function NewInfluencerPage() {
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
  if (!canEdit) redirect("/crm/influencer");

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/crm/influencer"
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to Influencer CRM
      </Link>
      <InfluencerForm mode="create" canEdit={canEdit} />
    </div>
  );
}
