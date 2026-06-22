import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isEditorRole } from "@/lib/auth/permissions";
import {
  type OrgType,
  ORG_TYPE_LABELS,
  crmSectionBySlug,
} from "@/lib/crm/types";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import { OrganizationForm } from "../[id]/organization-form";
import type { LocationOption } from "../[id]/location-multi-select";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section: slug } = await searchParams;
  const section = crmSectionBySlug(slug ?? "");
  // Only organization-backed sections (vendor, business) create rows here.
  if (!section || section.entity !== "organization" || !section.orgTypes?.length) {
    notFound();
  }

  const current = await getCurrentUser();
  const canEdit = current ? isEditorRole(current.appUser.role) : false;
  if (!canEdit) redirect(`/crm/${section.slug}`);

  const supabase = await createClient();
  const { data: locationData } = await supabase
    .from("location")
    .select(LOCATION_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const locationOptions: LocationOption[] = (
    (locationData ?? []) as unknown as Location[]
  ).map((l) => ({ value: l.name, label: l.display_name ?? l.name }));

  const orgTypeOptions = section.orgTypes.map((t) => ({
    value: t,
    label: ORG_TYPE_LABELS[t],
  }));
  const defaultOrgType: OrgType = section.orgTypes[0];

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/crm/${section.slug}`}
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to {section.title}
      </Link>
      <OrganizationForm
        mode="create"
        orgType={defaultOrgType}
        orgTypeOptions={orgTypeOptions}
        locations={locationOptions}
        canEdit={canEdit}
      />
    </div>
  );
}
