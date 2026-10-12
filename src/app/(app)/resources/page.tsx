import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageDocuments, canViewDocument, isDocumentRecipient, signatureState } from "@/lib/resources/access";
import {
  RESOURCE_LIST_COLUMNS,
  resourceHref,
  type ResourceCategory,
  type ResourceDocument,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";
import { PoliciesLibrary } from "./policies-library";

export default async function ResourcesPage() {
  const current = await requireUser();
  // HR / Manager and above manage the library; everyone else reads it.
  const canUpload = canManageDocuments(current.appUser);

  const admin = createAdminClient();
  const [{ data, error }, { data: categoryRows }, { data: viewerRows }, { data: mySigs }] = await Promise.all([
    admin
      .from("resource_document")
      .select(RESOURCE_LIST_COLUMNS)
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
    admin.from("resource_document_viewer").select("document_id").eq("app_user_id", current.authId),
    admin
      .from("resource_document_signature")
      .select("document_id, version_no")
      .eq("app_user_id", current.authId),
  ]);
  if (error) throw new Error(`Could not load resources: ${error.message}`);

  const namedOn = new Set((viewerRows ?? []).map((r) => (r as { document_id: string }).document_id));
  const signedVersions = new Map<string, number[]>();
  for (const s of (mySigs ?? []) as { document_id: string; version_no: number }[]) {
    signedVersions.set(s.document_id, [...(signedVersions.get(s.document_id) ?? []), s.version_no]);
  }

  // The service-role client bypasses RLS, so apply the same visibility rule here.
  const mine = (id: string) => (namedOn.has(id) ? new Set([current.authId]) : new Set<string>());
  const documents: ResourceDocumentWithUrl[] = ((data ?? []) as unknown as (ResourceDocument & { native: string | null })[])
    .map((row) => ({ ...row, is_native: row.native === "doc" }))
    .filter((d) => canViewDocument(current.appUser, d, mine(d.id)))
    .map((d) => ({
      ...d,
      signed_url: resourceHref(d),
      // Only the people a document is addressed to are asked to sign it.
      my_signature: isDocumentRecipient(current.appUser, d, mine(d.id))
        ? signatureState(d, signedVersions.get(d.id) ?? [])
        : "not_required",
    }));
  const categories = (categoryRows ?? []) as ResourceCategory[];

  return (
    <PoliciesLibrary
      documents={documents}
      categories={categories}
      canUpload={canUpload}
    />
  );
}
