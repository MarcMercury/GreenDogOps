import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  POLICY_CATEGORIES,
  type ResourceDocument,
  type ResourceDocumentWithUrl,
} from "@/lib/resources/types";
import { PoliciesLibrary } from "./policies-library";

export default async function ResourcesPoliciesPage() {
  await requireUser();

  const admin = createAdminClient();
  const { data } = await admin
    .from("resource_document")
    .select("*")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  const documents = (data ?? []) as ResourceDocument[];

  let withUrls: ResourceDocumentWithUrl[] = documents.map((d) => ({
    ...d,
    signed_url: null,
  }));

  if (documents.length > 0) {
    const { data: signed } = await admin.storage
      .from("resources")
      .createSignedUrls(
        documents.map((d) => d.storage_path),
        60 * 60,
      );
    if (signed) {
      withUrls = documents.map((d, i) => ({
        ...d,
        signed_url: signed[i]?.signedUrl ?? null,
      }));
    }
  }

  return <PoliciesLibrary documents={withUrls} policies={POLICY_CATEGORIES} />;
}
