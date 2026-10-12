import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageDocuments, documentAudience } from "@/lib/resources/access";
import { sanitizeDocument } from "@/lib/resources/content";
import { loadActiveUsers, loadViewerIds } from "@/lib/resources/server";
import { resourceKind, type ResourceCategory, type ResourceDocument } from "@/lib/resources/types";
import { DocumentEditor } from "../../_components/document-editor";

export const dynamic = "force-dynamic";

export default async function EditResourceDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser();
  const { id } = await params;
  if (!canManageDocuments(current.appUser)) redirect(`/resources/doc/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const admin = createAdminClient();
  const [{ data }, { data: cats }, users, viewers] = await Promise.all([
    admin.from("resource_document").select("*").eq("id", id).maybeSingle(),
    admin
      .from("resource_category")
      .select("key, label, icon, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("label"),
    loadActiveUsers(admin),
    loadViewerIds(admin, id),
  ]);
  const doc = data as ResourceDocument | null;
  if (!doc) notFound();
  if (resourceKind(doc) !== "native") redirect(`/resources/doc/${id}`);

  return (
    <DocumentEditor
      initial={{
        id: doc.id,
        title: doc.title,
        category: doc.category,
        description: doc.description ?? "",
        content: sanitizeDocument(doc.content_json),
        baseVersion: doc.current_version,
        requireSignature: doc.require_signature,
      }}
      categories={(cats ?? []) as ResourceCategory[]}
      audienceCount={documentAudience(doc, users, viewers).filter((u) => u.id !== current.authId).length}
    />
  );
}
