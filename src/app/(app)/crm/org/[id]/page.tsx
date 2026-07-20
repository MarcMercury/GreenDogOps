import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import {
  type CrmOrganization,
  type CrmOrgDocument,
  type CrmOrgDocumentWithUrl,
  crmSectionBySlug,
  crmSlugForOrg,
} from "@/lib/crm/types";
import { LOCATION_COLUMNS, type Location } from "@/lib/shared/locations";
import { OrganizationForm } from "./organization-form";
import type { LocationOption } from "./location-multi-select";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
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

  const org = data as CrmOrganization;
  const section = crmSectionBySlug(crmSlugForOrg(org));

  const { data: locationData } = await supabase
    .from("location")
    .select(LOCATION_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const locationOptions: LocationOption[] = (
    (locationData ?? []) as unknown as Location[]
  ).map((l) => ({ value: l.name, label: l.display_name ?? l.name }));

  // Uploaded document attachments (private bucket → short-lived signed URLs).
  const { data: docData } = await supabase
    .from("crm_org_document")
    .select("*")
    .eq("org_id", id)
    .order("uploaded_at", { ascending: false });
  const documents = (docData ?? []) as CrmOrgDocument[];

  // Marketing Resources (tool/login vault rows) that point back at this org.
  const { data: resourceData } = await supabase
    .from("marketing_resource")
    .select("id, name, category, url")
    .eq("crm_organization_id", id)
    .order("name", { ascending: true });
  const linkedResources = (resourceData ?? []) as Array<{
    id: string;
    name: string;
    category: string;
    url: string | null;
  }>;

  let documentsWithUrls: CrmOrgDocumentWithUrl[] = documents.map((d) => ({
    ...d,
    signed_url: null,
  }));
  if (documents.length > 0) {
    const admin = createAdminClient();
    const { data: signed } = await admin.storage
      .from("crm-documents")
      .createSignedUrls(
        documents.map((d) => d.storage_path),
        60 * 60,
      );
    if (signed) {
      documentsWithUrls = documents.map((d, i) => ({
        ...d,
        signed_url: signed[i]?.signedUrl ?? null,
      }));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={section ? `/crm/${section.slug}` : "/crm"}
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to {section?.title ?? "CRM"}
      </Link>
      <OrganizationForm
        org={org}
        locations={locationOptions}
        documents={documentsWithUrls}
        canEdit={canEdit}
      />

      {linkedResources.length > 0 && (
        <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <span aria-hidden>🧰</span> Linked Marketing Resources
          </h2>
          <p className="mt-0.5 text-xs text-emerald-800/70">
            Tools / logins in Marketing → Resources tied to this record.
          </p>
          <ul className="mt-3 space-y-2">
            {linkedResources.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-900">{r.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {r.category}
                </span>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    Open ↗
                  </a>
                )}
                <Link
                  href="/marketing?tab=resources"
                  className="ml-auto text-xs text-emerald-700 hover:text-emerald-900"
                >
                  View in Marketing →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
