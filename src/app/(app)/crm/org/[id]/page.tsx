import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CrmOrganization } from "@/lib/crm/types";
import { OrganizationForm } from "./organization-form";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_organization")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load organization: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/crm" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to CRM
      </Link>
      <OrganizationForm org={data as CrmOrganization} />
    </div>
  );
}
