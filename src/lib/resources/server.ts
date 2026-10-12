import "server-only";

// Server helpers for Resources documents: who the access group is, notifying
// it, version snapshots, and the Ask Ziggy text index. Callers re-check
// permissions first — everything here runs on the service-role client.

import { createAdminClient } from "@/lib/supabase/admin";
import { publishNotification } from "@/lib/notify/publish";
import type { AppRole } from "@/lib/auth/permissions";
import { documentAudience, isDocumentRecipient, signatureState } from "./access";
import { chunkText } from "./chunk-text";
import type { ResourceDocument } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export interface AudienceUser {
  id: string;
  role: AppRole;
  is_active: boolean;
  full_name: string | null;
  email: string;
  person_id: string | null;
}

/** Active GDO users, for access pickers and audiences. */
export async function loadActiveUsers(admin: Admin): Promise<AudienceUser[]> {
  const { data, error } = await admin
    .from("app_user")
    .select("id, role, is_active, full_name, email, person_id")
    .eq("is_active", true)
    .order("full_name", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Could not load users: ${error.message}`);
  return (data ?? []) as AudienceUser[];
}

export async function loadViewerIds(admin: Admin, documentId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("resource_document_viewer")
    .select("app_user_id")
    .eq("document_id", documentId);
  if (error) throw new Error(`Could not load document viewers: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { app_user_id: string }).app_user_id));
}

/** The document's access group: every active user who can view it. */
export async function loadAudience(
  admin: Admin,
  doc: Pick<ResourceDocument, "id" | "visible_roles">,
): Promise<AudienceUser[]> {
  const [users, viewers] = await Promise.all([loadActiveUsers(admin), loadViewerIds(admin, doc.id)]);
  return documentAudience(doc, users, viewers);
}

/**
 * Make sure the document has a version row describing what it is right now
 * (legacy files and links start at version 0). Returns the current version.
 */
export async function ensureCurrentVersion(
  admin: Admin,
  doc: ResourceDocument,
  actorId: string | null,
): Promise<number> {
  if (doc.current_version > 0) return doc.current_version;
  if (!doc.storage_path && !doc.content_json) {
    throw new Error("Links to other sites have no versions to sign.");
  }
  const { error } = await admin.from("resource_document_version").insert({
    document_id: doc.id,
    version_no: 1,
    title: doc.title,
    content_json: doc.content_json ?? null,
    content_text: doc.content_json ? (doc.content_text ?? null) : null,
    storage_path: doc.storage_path,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
    size_bytes: doc.size_bytes,
    change_note: "Existing document",
    created_by: actorId,
  });
  if (error && error.code !== "23505") throw new Error(`Could not record the version: ${error.message}`);
  const { error: upErr } = await admin
    .from("resource_document")
    .update({ current_version: 1 })
    .eq("id", doc.id)
    .eq("current_version", 0);
  if (upErr) throw new Error(`Could not record the version: ${upErr.message}`);
  return 1;
}

/** Replace the Ask Ziggy chunks for a document. Best effort — never fails a save. */
export async function reindexDocument(admin: Admin, documentId: string, text: string | null): Promise<void> {
  try {
    await admin.from("resource_document_chunk").delete().eq("document_id", documentId);
    const chunks = text ? chunkText(text) : [];
    if (chunks.length) {
      await admin
        .from("resource_document_chunk")
        .insert(chunks.map((content, chunk_index) => ({ document_id: documentId, chunk_index, content })));
    }
    await admin
      .from("resource_document")
      .update({ content_synced_at: new Date().toISOString() })
      .eq("id", documentId);
  } catch {
    // The document itself is saved; a stale search index is recoverable.
  }
}

export interface NotifyResult {
  notified: number;
  failed: number;
}

/**
 * In-app notification to everyone in the access group except the sender.
 * Deduped per document version, so re-sending the same version is a no-op.
 */
export async function notifyAudience(
  admin: Admin,
  doc: Pick<ResourceDocument, "id" | "title" | "visible_roles">,
  version: number,
  opts: { actorUserId: string; signatureRequired: boolean; note?: string | null },
): Promise<NotifyResult> {
  const audience = (await loadAudience(admin, doc)).filter((u) => u.id !== opts.actorUserId);
  let notified = 0;
  let failed = 0;
  for (const u of audience) {
    const res = await publishNotification({
      recipientUserId: u.id,
      kind: opts.signatureRequired ? "resource.signature_requested" : "resource.updated",
      title: opts.signatureRequired
        ? `Please review and sign: ${doc.title}`
        : `Document updated: ${doc.title}`,
      body: opts.note?.trim()
        ? opts.note.trim()
        : opts.signatureRequired
          ? "Open the document, read it, and add your initials to confirm."
          : null,
      href: `/resources/doc/${doc.id}`,
      module: "resources",
      severity: opts.signatureRequired ? "action" : "info",
      actorUserId: opts.actorUserId,
      dedupeKey: `resource:${doc.id}:v${version}:${opts.signatureRequired ? "sign" : "update"}`,
    });
    if (res.ok) notified += 1;
    else failed += 1;
  }
  await admin
    .from("resource_document_version")
    .update({ notified_count: notified })
    .eq("document_id", doc.id)
    .eq("version_no", version);
  return { notified, failed };
}

export interface SignatureRow {
  id: string;
  document_id: string;
  version_no: number;
  document_title: string;
  app_user_id: string | null;
  person_id: string | null;
  signer_name: string;
  initials: string;
  signed_on: string;
  signed_at: string;
}

export interface SignerStatus {
  user: AudienceUser;
  state: "signed" | "pending";
  signature: SignatureRow | null;
}

/** Per-person status for a document that requires signatures (manager view). */
export async function loadSignatureStatus(
  admin: Admin,
  doc: ResourceDocument,
): Promise<{ statuses: SignerStatus[]; others: SignatureRow[]; all: SignatureRow[] }> {
  const [audience, { data, error }] = await Promise.all([
    loadAudience(admin, doc),
    admin
      .from("resource_document_signature")
      .select("id, document_id, version_no, document_title, app_user_id, person_id, signer_name, initials, signed_on, signed_at")
      .eq("document_id", doc.id)
      .order("version_no", { ascending: false })
      .order("signed_at", { ascending: false }),
  ]);
  if (error) throw new Error(`Could not load signatures: ${error.message}`);
  const sigs = (data ?? []) as SignatureRow[];
  const byUser = new Map<string, SignatureRow[]>();
  for (const s of sigs) {
    if (!s.app_user_id) continue;
    byUser.set(s.app_user_id, [...(byUser.get(s.app_user_id) ?? []), s]);
  }
  const audienceIds = new Set(audience.map((u) => u.id));
  const statuses = audience.map((user) => {
    const mine = byUser.get(user.id) ?? [];
    const state = signatureState(doc, mine.map((s) => s.version_no)) === "signed" ? "signed" : "pending";
    return { user, state, signature: mine[0] ?? null } as SignerStatus;
  });
  statuses.sort((a, b) =>
    a.state === b.state
      ? (a.user.full_name ?? a.user.email).localeCompare(b.user.full_name ?? b.user.email)
      : a.state === "pending" ? -1 : 1,
  );
  // Signatures from people no longer in the access group stay on record.
  const others = sigs.filter((s) => !s.app_user_id || !audienceIds.has(s.app_user_id));
  return { statuses, others, all: sigs };
}

export interface PersonPolicyStatus {
  signed: {
    id: string;
    document_id: string;
    document_title: string;
    version_no: number;
    initials: string;
    signed_on: string;
    signed_at: string;
    /** Still satisfies the document's current signature requirement. */
    current: boolean;
  }[];
  pending: { document_id: string; title: string; version: number }[];
}

/**
 * Policy acknowledgements for one employee's HR profile: every signature on
 * record, plus documents they can view that still need their signature.
 * Callers gate this exactly like the confidential Documents tab.
 */
export async function loadPersonPolicyStatus(admin: Admin, personId: string): Promise<PersonPolicyStatus> {
  const [{ data: login }, { data: sigRows, error: sigErr }] = await Promise.all([
    admin.from("app_user").select("id, role, is_active").eq("person_id", personId).maybeSingle(),
    admin
      .from("resource_document_signature")
      .select("id, document_id, document_title, version_no, initials, signed_on, signed_at, app_user_id")
      .eq("person_id", personId)
      .order("signed_at", { ascending: false }),
  ]);
  if (sigErr) throw new Error(`Could not load policy signatures: ${sigErr.message}`);
  const user = login as { id: string; role: AppRole; is_active: boolean } | null;

  const { data: docRows } = await admin
    .from("resource_document")
    .select("id, title, visible_roles, current_version, require_signature, signature_from_version")
    .eq("is_active", true)
    .eq("require_signature", true);
  const required = (docRows ?? []) as (Pick<ResourceDocument, "id" | "title" | "visible_roles" | "current_version" | "require_signature" | "signature_from_version">)[];
  const requiredById = new Map(required.map((d) => [d.id, d]));

  const sigs = (sigRows ?? []) as (Omit<PersonPolicyStatus["signed"][number], "current"> & { app_user_id: string | null })[];
  const signed = sigs.map((s) => {
    const doc = requiredById.get(s.document_id);
    return {
      id: s.id,
      document_id: s.document_id,
      document_title: s.document_title,
      version_no: s.version_no,
      initials: s.initials,
      signed_on: s.signed_on,
      signed_at: s.signed_at,
      current: !!doc && signatureState(doc, [s.version_no]) === "signed",
    };
  });

  const pending: PersonPolicyStatus["pending"] = [];
  if (user?.is_active && required.length) {
    const { data: viewerRows } = await admin
      .from("resource_document_viewer")
      .select("document_id")
      .eq("app_user_id", user.id);
    const namedOn = new Set((viewerRows ?? []).map((r) => (r as { document_id: string }).document_id));
    const versionsByDoc = new Map<string, number[]>();
    for (const s of sigs) versionsByDoc.set(s.document_id, [...(versionsByDoc.get(s.document_id) ?? []), s.version_no]);
    for (const d of required) {
      const viewers = namedOn.has(d.id) ? new Set([user.id]) : new Set<string>();
      if (!isDocumentRecipient(user, d, viewers)) continue;
      if (signatureState(d, versionsByDoc.get(d.id) ?? []) === "pending") {
        pending.push({ document_id: d.id, title: d.title, version: d.current_version });
      }
    }
    pending.sort((a, b) => a.title.localeCompare(b.title));
  }
  return { signed, pending };
}
