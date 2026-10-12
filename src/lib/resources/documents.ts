import "server-only";

// Native policy documents: create/edit, replace file, send, access, sign.
// Every function takes the signed-in user and re-checks permissions itself;
// the Server Actions in src/app/(app)/resources/doc/actions.ts are thin
// wrappers that resolve the user and refresh the affected pages.

import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, type CurrentUser } from "@/lib/auth/session";
import { safeUploadContentType } from "@/lib/security/upload";
import {
  canManageDocuments,
  canViewDocument,
  clinicToday,
  isDocumentRecipient,
  normalizeInitials,
  normalizeVisibleRoles,
} from "@/lib/resources/access";
import {
  MAX_DOCUMENT_BYTES,
  documentText,
  isEmptyDocument,
  sanitizeDocument,
} from "@/lib/resources/content";
import {
  ensureCurrentVersion,
  loadActiveUsers,
  loadViewerIds,
  notifyAudience,
  reindexDocument,
} from "@/lib/resources/server";
import { resourceKind, type ResourceDocument } from "@/lib/resources/types";

export type DocActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string };

const RESOURCES_BUCKET = "resources";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_FILE = /\.(pdf|docx?)$/i;

type Admin = ReturnType<typeof createAdminClient>;

const NOT_MANAGER: DocActionResult = { ok: false, error: "Only HR / Managers and above can manage documents." };

async function loadDocument(admin: Admin, id: string): Promise<ResourceDocument | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("resource_document").select("*").eq("id", id).maybeSingle();
  return (data as ResourceDocument | null) ?? null;
}

async function categoryExists(admin: Admin, key: string): Promise<boolean> {
  const { data } = await admin
    .from("resource_category")
    .select("key")
    .eq("key", key)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * When asked, make `version` the one everybody must sign; then notify the
 * access group. Returns a short summary for the editor.
 */
async function publishVersion(
  admin: Admin,
  current: CurrentUser,
  doc: ResourceDocument,
  version: number,
  opts: { notify: boolean; requireSignature: boolean; note: string | null },
): Promise<string> {
  if (opts.requireSignature) {
    const { error } = await admin
      .from("resource_document")
      .update({ require_signature: true, signature_from_version: version })
      .eq("id", doc.id);
    if (error) throw new Error(`Could not request signatures: ${error.message}`);
    await admin
      .from("resource_document_version")
      .update({ signature_required: true })
      .eq("document_id", doc.id)
      .eq("version_no", version);
  }
  if (!opts.notify && !opts.requireSignature) return "";
  const res = await notifyAudience(admin, doc, version, {
    actorUserId: current.authId,
    signatureRequired: opts.requireSignature,
    note: opts.note,
  });
  const people = res.notified === 1 ? "1 person" : `${res.notified} people`;
  return res.failed ? `Notified ${people}; ${res.failed} could not be notified.` : `Notified ${people}.`;
}

// ---------------------------------------------------------------------------
// Create / edit a native document
// ---------------------------------------------------------------------------

export interface SaveNativeInput {
  id?: string | null;
  title: string;
  category: string;
  description?: string | null;
  content: unknown;
  changeNote?: string | null;
  notify: boolean;
  requireSignature: boolean;
  /** current_version the editor started from, to catch concurrent saves. */
  baseVersion?: number;
  /** New documents only: who can view, applied before anyone is notified. */
  access?: { everyone: boolean; roles: string[]; viewerIds: string[] } | null;
}

export async function saveNativeDocumentAs(current: CurrentUser, input: SaveNativeInput): Promise<DocActionResult> {
  if (!canManageDocuments(current.appUser)) return NOT_MANAGER;

  const title = clean(input.title, 200);
  if (!title) return { ok: false, error: "Please enter a title." };
  const description = clean(input.description, 500);
  const changeNote = clean(input.changeNote, 500);
  const doc = sanitizeDocument(input.content);
  if (!doc || isEmptyDocument(doc)) return { ok: false, error: "The document is empty." };
  if (JSON.stringify(doc).length > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "The document is too large (12 MB max). Use smaller images." };
  }
  const text = documentText(doc);

  const admin = createAdminClient();
  const category = clean(input.category, 60) ?? "general";
  if (!(await categoryExists(admin, category))) return { ok: false, error: "Please choose a valid category." };

  let existing: ResourceDocument | null = null;
  if (input.id) {
    existing = await loadDocument(admin, input.id);
    if (!existing) return { ok: false, error: "That document no longer exists." };
    if (resourceKind(existing) !== "native") return { ok: false, error: "Only Ops documents can be edited here." };
    if (input.baseVersion !== undefined && input.baseVersion !== existing.current_version) {
      return {
        ok: false,
        error: "Someone else saved this document while you were editing. Copy your changes, reload, and try again.",
      };
    }
  }

  let docId = existing?.id ?? null;
  if (!docId) {
    const access = input.access;
    const visibleRoles = !access || access.everyone ? null : normalizeVisibleRoles(access.roles);
    const { data, error } = await admin
      .from("resource_document")
      .insert({
        title,
        category,
        description,
        visible_roles: visibleRoles,
        content_json: doc,
        content_text: text,
        mime_type: null,
        sort_order: 50,
        uploaded_by: current.authId,
        updated_by: current.authId,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const newId = (data as { id: string }).id;
    docId = newId;
    if (access && !access.everyone && access.viewerIds.length) {
      const active = new Set((await loadActiveUsers(admin)).map((u) => u.id));
      const viewers = [...new Set(access.viewerIds)].filter((v) => active.has(v));
      if (viewers.length) {
        const { error: vwErr } = await admin
          .from("resource_document_viewer")
          .insert(viewers.map((app_user_id) => ({ document_id: newId, app_user_id, added_by: current.authId })));
        if (vwErr) {
          await admin.from("resource_document").delete().eq("id", newId);
          return { ok: false, error: vwErr.message };
        }
      }
    }
  }

  const prevVersion = existing?.current_version ?? 0;
  const version = prevVersion + 1;
  const { error: vErr } = await admin.from("resource_document_version").insert({
    document_id: docId,
    version_no: version,
    title,
    content_json: doc,
    content_text: text,
    change_note: changeNote ?? (existing ? null : "Created"),
    created_by: current.authId,
  });
  if (vErr) {
    if (!existing) await admin.from("resource_document").delete().eq("id", docId);
    return {
      ok: false,
      error: vErr.code === "23505" ? "Someone else saved this document at the same time. Reload and try again." : vErr.message,
    };
  }

  const { data: updated, error: uErr } = await admin
    .from("resource_document")
    .update({
      title,
      category,
      description,
      content_json: doc,
      content_text: text,
      current_version: version,
      updated_by: current.authId,
    })
    .eq("id", docId)
    .eq("current_version", prevVersion)
    .select("*")
    .maybeSingle();
  if (uErr || !updated) {
    await admin.from("resource_document_version").delete().eq("document_id", docId).eq("version_no", version);
    if (!existing) await admin.from("resource_document").delete().eq("id", docId);
    return { ok: false, error: uErr?.message ?? "Someone else saved this document at the same time. Reload and try again." };
  }

  await reindexDocument(admin, docId, text);

  let message = "";
  try {
    message = await publishVersion(admin, current, updated as ResourceDocument, version, {
      notify: input.notify,
      requireSignature: input.requireSignature,
      note: changeNote,
    });
  } catch (err) {
    message = `Saved, but notifying failed: ${errorText(err)}`;
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: existing ? "resource.document_edited" : "resource.document_created",
    entity: "resource_document",
    entityId: docId,
    summary: `${existing ? "Edited" : "Created"} "${title}" (version ${version})`,
    metadata: { version, notify: input.notify, require_signature: input.requireSignature },
  });

  return { ok: true, id: docId, message: message || `Saved version ${version}.` };
}

// ---------------------------------------------------------------------------
// Replace an uploaded file (new version)
// ---------------------------------------------------------------------------

async function pdfText(file: File): Promise<string | null> {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return null;
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (Array.isArray(text) ? text.join("\n") : text).replace(/\n{3,}/g, "\n\n").trim();
    return t.length >= 200 ? t : null;
  } catch {
    return null;
  }
}

export interface ReplaceFileInput {
  id: string | null;
  file: unknown;
  changeNote: string | null;
  notify: boolean;
  requireSignature: boolean;
}

export async function replaceDocumentFileAs(current: CurrentUser, input: ReplaceFileInput): Promise<DocActionResult> {
  if (!canManageDocuments(current.appUser)) return NOT_MANAGER;

  const id = clean(input.id, 40);
  const file = input.file;
  if (!id) return { ok: false, error: "Missing document." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a file." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "File exceeds the 25 MB limit." };
  if (!ALLOWED_FILE.test(file.name)) return { ok: false, error: "Only PDF or Word documents are allowed." };

  const admin = createAdminClient();
  const doc = await loadDocument(admin, id);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  if (resourceKind(doc) !== "file") return { ok: false, error: "Only uploaded files can be replaced." };

  let prevVersion: number;
  try {
    prevVersion = await ensureCurrentVersion(admin, doc, current.authId);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${doc.category}/${Date.now()}_${safeName}`;
  const { error: upErr } = await admin.storage
    .from(RESOURCES_BUCKET)
    .upload(storagePath, file, { contentType: safeUploadContentType(file.name, file.type), upsert: false });
  if (upErr) return { ok: false, error: upErr.message };

  const version = prevVersion + 1;
  const changeNote = clean(input.changeNote, 500);
  const { error: vErr } = await admin.from("resource_document_version").insert({
    document_id: doc.id,
    version_no: version,
    title: doc.title,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    change_note: changeNote,
    created_by: current.authId,
  });
  const { data: updated, error: uErr } = vErr
    ? { data: null, error: vErr }
    : await admin
        .from("resource_document")
        .update({
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          current_version: version,
          updated_by: current.authId,
        })
        .eq("id", doc.id)
        .eq("current_version", prevVersion)
        .select("*")
        .maybeSingle();
  if (uErr || !updated) {
    if (!vErr) await admin.from("resource_document_version").delete().eq("document_id", doc.id).eq("version_no", version);
    await admin.storage.from(RESOURCES_BUCKET).remove([storagePath]);
    return { ok: false, error: uErr?.message ?? "Someone else changed this document. Reload and try again." };
  }

  await reindexDocument(admin, doc.id, await pdfText(file));

  let message = "";
  try {
    message = await publishVersion(admin, current, updated as ResourceDocument, version, {
      notify: input.notify,
      requireSignature: input.requireSignature,
      note: changeNote,
    });
  } catch (err) {
    message = `Saved, but notifying failed: ${errorText(err)}`;
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.file_replaced",
    entity: "resource_document",
    entityId: doc.id,
    summary: `Replaced the file of "${doc.title}" (version ${version})`,
    metadata: { version, file_name: file.name, size_bytes: file.size },
  });

  return { ok: true, id: doc.id, message: message || `Uploaded version ${version}.` };
}

// ---------------------------------------------------------------------------
// Send the current version to the access group
// ---------------------------------------------------------------------------

export async function sendDocumentAs(
  current: CurrentUser,
  input: { id: string; requireSignature: boolean; note?: string | null },
): Promise<DocActionResult> {
  if (!canManageDocuments(current.appUser)) return NOT_MANAGER;

  const admin = createAdminClient();
  const doc = await loadDocument(admin, input.id);
  if (!doc || !doc.is_active) return { ok: false, error: "That document no longer exists." };
  const isLink = resourceKind(doc) === "link";
  if (isLink && input.requireSignature) {
    return { ok: false, error: "Links to other sites cannot collect signatures." };
  }

  let message: string;
  try {
    const version = isLink ? 0 : await ensureCurrentVersion(admin, doc, current.authId);
    message = await publishVersion(admin, current, { ...doc, current_version: version }, version, {
      notify: true,
      requireSignature: input.requireSignature,
      note: clean(input.note, 500),
    });
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: input.requireSignature ? "resource.signature_requested" : "resource.sent",
    entity: "resource_document",
    entityId: doc.id,
    summary: `${input.requireSignature ? "Requested signatures on" : "Sent"} "${doc.title}". ${message}`,
  });

  return { ok: true, message };
}

export async function stopSignatureRequirementAs(current: CurrentUser, id: string): Promise<DocActionResult> {
  if (!canManageDocuments(current.appUser)) return NOT_MANAGER;
  const admin = createAdminClient();
  const doc = await loadDocument(admin, id);
  if (!doc) return { ok: false, error: "That document no longer exists." };
  const { error } = await admin
    .from("resource_document")
    .update({ require_signature: false, signature_from_version: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.signature_stopped",
    entity: "resource_document",
    entityId: id,
    summary: `Stopped requiring signatures on "${doc.title}" (existing signatures are kept)`,
  });
  return { ok: true, message: "Signatures are no longer required. Existing signatures are kept." };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface AccessInput {
  id: string;
  everyone: boolean;
  roles: string[];
  viewerIds: string[];
}

export async function updateDocumentAccessAs(current: CurrentUser, input: AccessInput): Promise<DocActionResult> {
  if (!canManageDocuments(current.appUser)) return NOT_MANAGER;

  const admin = createAdminClient();
  const doc = await loadDocument(admin, input.id);
  if (!doc) return { ok: false, error: "That document no longer exists." };

  const roles = input.everyone ? null : normalizeVisibleRoles(input.roles);
  const active = new Set((await loadActiveUsers(admin)).map((u) => u.id));
  const viewerIds = input.everyone ? [] : [...new Set(input.viewerIds)].filter((v) => active.has(v));

  const { error } = await admin.from("resource_document").update({ visible_roles: roles }).eq("id", doc.id);
  if (error) return { ok: false, error: error.message };

  const before = await loadViewerIds(admin, doc.id);
  const remove = [...before].filter((v) => !viewerIds.includes(v));
  const add = viewerIds.filter((v) => !before.has(v));
  if (remove.length) {
    const { error: dErr } = await admin
      .from("resource_document_viewer")
      .delete()
      .eq("document_id", doc.id)
      .in("app_user_id", remove);
    if (dErr) return { ok: false, error: dErr.message };
  }
  if (add.length) {
    const { error: iErr } = await admin
      .from("resource_document_viewer")
      .insert(add.map((app_user_id) => ({ document_id: doc.id, app_user_id, added_by: current.authId })));
    if (iErr) return { ok: false, error: iErr.message };
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.access_changed",
    entity: "resource_document",
    entityId: doc.id,
    summary: `Changed who can view "${doc.title}"`,
    metadata: { visible_roles: roles, viewers_added: add.length, viewers_removed: remove.length },
  });

  return { ok: true, message: "Access updated." };
}

// ---------------------------------------------------------------------------
// Sign (initials + date)
// ---------------------------------------------------------------------------

export async function signDocumentAs(
  current: CurrentUser,
  input: { id: string; version: number; initials: string },
  userAgent: string | null,
): Promise<DocActionResult> {
  const initials = normalizeInitials(String(input.initials ?? ""));
  if (!initials) return { ok: false, error: "Enter your initials (letters only)." };

  const admin = createAdminClient();
  const doc = await loadDocument(admin, input.id);
  if (!doc || !doc.is_active) return { ok: false, error: "That document no longer exists." };
  const viewers = await loadViewerIds(admin, doc.id);
  if (!canViewDocument(current.appUser, doc, viewers)) return { ok: false, error: "You don't have access to this document." };
  if (!doc.require_signature) return { ok: false, error: "This document does not need a signature." };
  if (!isDocumentRecipient(current.appUser, doc, viewers)) {
    return { ok: false, error: "This document was not sent to you for signature." };
  }
  if (input.version !== doc.current_version) {
    return { ok: false, error: "This document was just updated. Reload the page and review the new version." };
  }

  const { data: version } = await admin
    .from("resource_document_version")
    .select("id")
    .eq("document_id", doc.id)
    .eq("version_no", doc.current_version)
    .maybeSingle();
  if (!version) return { ok: false, error: "This version cannot be signed. Ask HR to resend it." };

  const ua = userAgent;
  const { error } = await admin.from("resource_document_signature").insert({
    document_id: doc.id,
    version_id: (version as { id: string }).id,
    version_no: doc.current_version,
    document_title: doc.title,
    app_user_id: current.authId,
    person_id: current.appUser.person_id,
    signer_name: current.appUser.full_name?.trim() || current.email,
    signer_email: current.email,
    initials,
    signed_on: clinicToday(),
    user_agent: ua ? ua.slice(0, 400) : null,
  });
  if (error) {
    if (error.code === "23505") return { ok: true, message: "You already signed this version." };
    return { ok: false, error: error.message };
  }

  // The sign-request notification is done once they have signed.
  await admin
    .from("user_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", current.authId)
    .like("dedupe_key", `resource:${doc.id}:%`)
    .is("read_at", null);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.signed",
    entity: "resource_document",
    entityId: doc.id,
    summary: `Signed "${doc.title}" version ${doc.current_version} (initials ${initials})`,
  });

  return { ok: true, message: "Thank you — your signature is recorded." };
}
