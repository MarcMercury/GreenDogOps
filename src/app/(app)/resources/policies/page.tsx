import { requireUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  POLICY_CATEGORIES,
  type ResourceCategory,
  type ResourceDocument,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";
import { PoliciesLibrary } from "./policies-library";

export default async function ResourcesPoliciesPage() {
  const current = await requireUser();
  const canUpload = canEditGeneral(current.appUser);

  const admin = createAdminClient();
  const [{ data }, { data: categoryRows }] = await Promise.all([
    admin
      .from("resource_document")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true }),
    admin
      .from("resource_category")
      .select("key, label, icon, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
  ]);

  const documents = (data ?? []) as ResourceDocument[];
  const categories = (categoryRows ?? []) as ResourceCategory[];

  let withUrls: ResourceDocumentWithUrl[] = documents.map((d) => ({
    ...d,
    signed_url: d.source_url,
  }));

  // Only uploaded files (those with a storage_path) need a signed URL; link-only
  // rows already carry their href in source_url.
  const fileDocs = documents.filter((d) => d.storage_path);
  if (fileDocs.length > 0) {
    const { data: signed } = await admin.storage
      .from("resources")
      .createSignedUrls(
        fileDocs.map((d) => d.storage_path as string),
        60 * 60,
      );
    const urlByPath = new Map<string, string>();
    if (signed) {
      fileDocs.forEach((d, i) => {
        const url = signed[i]?.signedUrl;
        if (url) urlByPath.set(d.storage_path as string, url);
      });
    }
    withUrls = documents.map((d) => ({
      ...d,
      signed_url: d.storage_path
        ? (urlByPath.get(d.storage_path) ?? null)
        : d.source_url,
    }));
  }

  return (
    <PoliciesLibrary
      documents={withUrls}
      policies={POLICY_CATEGORIES}
      categories={categories}
      canUpload={canUpload}
    />
  );
}
