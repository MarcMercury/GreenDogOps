import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageDocuments,
  canViewDocument,
  describeAccess,
  documentAudience,
  isDocumentRecipient,
  signatureState,
} from "@/lib/resources/access";
import { sanitizeDocument, type DocNode } from "@/lib/resources/content";
import {
  loadActiveUsers,
  loadSignatureStatus,
  loadViewerIds,
  type SignatureRow,
  type SignerStatus,
} from "@/lib/resources/server";
import { resourceCategoryMeta, resourceKind, type ResourceDocument } from "@/lib/resources/types";
import { DocumentPage, type VersionInfo } from "./document-page";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResourceDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const current = await requireUser();
  const { id } = await params;
  const { v } = await searchParams;
  if (!UUID.test(id)) notFound();

  const admin = createAdminClient();
  const { data } = await admin.from("resource_document").select("*").eq("id", id).maybeSingle();
  const doc = data as (ResourceDocument & { superseded_by: string | null; updated_by: string | null }) | null;
  if (!doc) notFound();
  // Old links and notifications for a converted document land on its replacement.
  if (doc.superseded_by && !doc.is_active) redirect(`/resources/doc/${doc.superseded_by}`);

  const manager = canManageDocuments(current.appUser);
  const viewerIds = await loadViewerIds(admin, doc.id);
  if (!doc.is_active && !manager) notFound();
  if (!canViewDocument(current.appUser, doc, viewerIds)) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-3xl" aria-hidden>🔒</p>
        <p className="mt-2 font-medium text-slate-800">You don&apos;t have access to this document.</p>
        <p className="mt-1 text-sm text-slate-500">Ask HR if you think you should.</p>
        <Link href="/resources" className="mt-4 inline-block text-sm font-semibold text-emerald-700 hover:underline">
          ← Back to Resources
        </Link>
      </div>
    );
  }

  const kind = resourceKind(doc);
  if (kind === "link" && !manager && doc.source_url) redirect(doc.source_url);

  // Which version to show: the current one, or ?v=N from the history.
  const requested = Number(v);
  const showingOld = Number.isInteger(requested) && requested > 0 && requested !== doc.current_version;
  let content: DocNode | null = kind === "native" ? sanitizeDocument(doc.content_json) : null;
  let storagePath = doc.storage_path;
  let fileName = doc.file_name;
  let shownVersion = doc.current_version;
  let shownTitle = doc.title;
  if (showingOld) {
    const { data: ver } = await admin
      .from("resource_document_version")
      .select("version_no, title, content_json, storage_path, file_name")
      .eq("document_id", doc.id)
      .eq("version_no", requested)
      .maybeSingle();
    if (!ver) notFound();
    const vr = ver as { version_no: number; title: string; content_json: unknown; storage_path: string | null; file_name: string | null };
    content = vr.content_json ? sanitizeDocument(vr.content_json) : null;
    storagePath = vr.storage_path;
    fileName = vr.file_name;
    shownVersion = vr.version_no;
    shownTitle = vr.title;
  }

  let fileUrl: string | null = null;
  if (storagePath) {
    const { data: signed } = await admin.storage.from("resources").createSignedUrl(storagePath, 60 * 60);
    fileUrl = signed?.signedUrl ?? null;
  }

  const [{ data: mySigs }, { data: category }] = await Promise.all([
    admin
      .from("resource_document_signature")
      .select("version_no, initials, signed_on, signed_at")
      .eq("document_id", doc.id)
      .eq("app_user_id", current.authId)
      .order("version_no", { ascending: false }),
    admin.from("resource_category").select("label, icon").eq("key", doc.category).maybeSingle(),
  ]);
  const mine = (mySigs ?? []) as { version_no: number; initials: string; signed_on: string; signed_at: string }[];
  // Managers can open everything, but only the document's recipients sign it.
  const myState = isDocumentRecipient(current.appUser, doc, viewerIds)
    ? signatureState(doc, mine.map((s) => s.version_no))
    : "not_required";
  const catMeta = (category as { label: string; icon: string } | null) ?? resourceCategoryMeta(doc.category);

  // Manager-only data.
  let versions: VersionInfo[] = [];
  let statuses: SignerStatus[] = [];
  let others: SignatureRow[] = [];
  let history: SignatureRow[] = [];
  let people: { id: string; name: string; role: string }[] = [];
  let audienceCount = 0;
  let accessSummary = "";
  if (manager) {
    const users = await loadActiveUsers(admin);
    const nameOf = new Map(users.map((u) => [u.id, u.full_name?.trim() || u.email]));
    people = users.map((u) => ({ id: u.id, name: u.full_name?.trim() || u.email, role: u.role }));
    audienceCount = documentAudience(doc, users, viewerIds).length;
    accessSummary = describeAccess(doc.visible_roles, viewerIds.size);
    const { data: vers } = await admin
      .from("resource_document_version")
      .select("version_no, title, change_note, created_at, created_by, notified_count, signature_required, file_name")
      .eq("document_id", doc.id)
      .order("version_no", { ascending: false })
      .limit(50);
    versions = ((vers ?? []) as (Omit<VersionInfo, "author"> & { created_by: string | null })[]).map((x) => ({
      ...x,
      author: x.created_by ? (nameOf.get(x.created_by) ?? "Former user") : null,
    }));
    ({ statuses, others, all: history } = await loadSignatureStatus(admin, doc));
  }

  return (
    <DocumentPage
      doc={{
        id: doc.id,
        title: shownTitle,
        description: doc.description,
        kind,
        isActive: doc.is_active,
        categoryLabel: `${catMeta.icon} ${catMeta.label}`,
        currentVersion: doc.current_version,
        shownVersion,
        showingOld,
        updatedAt: doc.updated_at,
        requireSignature: doc.require_signature,
        signatureFromVersion: doc.signature_from_version,
        sourceUrl: doc.source_url,
        fileUrl,
        fileName,
        visibleRoles: doc.visible_roles,
        viewerIds: [...viewerIds],
      }}
      content={content}
      mySignature={{
        state: myState,
        latest: mine[0] ?? null,
      }}
      manager={
        manager
          ? { versions, statuses, others, history, people, audienceCount, accessSummary }
          : null
      }
    />
  );
}
