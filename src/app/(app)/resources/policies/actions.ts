"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";

const RESOURCES_BUCKET = "resources";
const MAX_BYTES = 25 * 1024 * 1024;

// PDF + Word document types only.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_EXT = /\.(pdf|docx?)$/i;

export type UploadResult = { ok: true } | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Slugify a label into a stable category key (lowercase, a-z0-9_). */
function categoryKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** True when a category key exists and is active. */
async function categoryExists(
  admin: ReturnType<typeof createAdminClient>,
  key: string,
): Promise<boolean> {
  const { data } = await admin
    .from("resource_category")
    .select("key")
    .eq("key", key)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

/** Upload a new policy/resource document. Admins and managers only. */
export async function uploadPolicyDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };

  if (!canEditGeneral(current.appUser)) {
    return { ok: false, error: "You don't have permission to upload." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File exceeds the 25 MB limit." };
  }
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return { ok: false, error: "Only PDF or Word documents are allowed." };
  }

  const admin = createAdminClient();

  const category = str(formData.get("category")) ?? "general";
  if (!(await categoryExists(admin, category))) {
    return { ok: false, error: "Please choose a valid category." };
  }

  const title = str(formData.get("title")) ?? file.name;
  const description = str(formData.get("description"));
  const staffOnly = formData.get("staff_only") === "on";

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${category}/${Date.now()}_${safeName}`;

  const { error: upErr } = await admin.storage
    .from(RESOURCES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await admin.from("resource_document").insert({
    title,
    category,
    description,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    staff_only: staffOnly,
    uploaded_by: current.authId,
  });

  if (dbErr) {
    // Roll back the orphaned upload so storage and the table stay in sync.
    await admin.storage.from(RESOURCES_BUCKET).remove([storagePath]);
    return { ok: false, error: dbErr.message };
  }

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.uploaded",
    entity: "resource_document",
    summary: `Uploaded policy document "${title}" (${category})`,
    metadata: { category, file_name: file.name, size_bytes: file.size },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Create a new document category. Admins and managers only. */
export async function createResourceCategory(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };

  if (!canEditGeneral(current.appUser)) {
    return {
      ok: false,
      error: "You don't have permission to create categories.",
    };
  }

  const label = str(formData.get("label"));
  if (!label) return { ok: false, error: "Please enter a category name." };

  const key = categoryKey(label);
  if (!key) {
    return { ok: false, error: "Please use letters or numbers in the name." };
  }

  const icon = str(formData.get("icon")) ?? "📄";

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("resource_category")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "A category with that name already exists." };
  }

  const { error: dbErr } = await admin.from("resource_category").insert({
    key,
    label,
    icon,
    sort_order: 90,
    created_by: current.authId,
  });

  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.category_created",
    entity: "resource_category",
    summary: `Created resource category "${label}"`,
    metadata: { key, label, icon },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Add an external reference link (no uploaded file). Editors only. */
export async function createResourceLink(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };
  if (!canEditGeneral(current.appUser)) {
    return { ok: false, error: "You don't have permission to add links." };
  }

  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Please enter a title." };

  const sourceUrl = str(formData.get("source_url"));
  if (!sourceUrl) return { ok: false, error: "Please enter a link URL." };
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return { ok: false, error: "Link must start with http:// or https://." };
  }

  const description = str(formData.get("description"));
  const staffOnly = formData.get("staff_only") === "on";

  const admin = createAdminClient();

  const category = str(formData.get("category")) ?? "general";
  if (!(await categoryExists(admin, category))) {
    return { ok: false, error: "Please choose a valid category." };
  }

  const { error: dbErr } = await admin.from("resource_document").insert({
    title,
    category,
    description,
    source_url: sourceUrl,
    staff_only: staffOnly,
    sort_order: 50,
    uploaded_by: current.authId,
  });
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.link_created",
    entity: "resource_document",
    summary: `Added resource link "${title}" (${category})`,
    metadata: { category, source_url: sourceUrl },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Rename / re-icon an existing category. Admins and managers only. */
export async function updateResourceCategory(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };
  if (!canEditGeneral(current.appUser)) {
    return { ok: false, error: "You don't have permission to edit categories." };
  }

  const key = str(formData.get("key"));
  if (!key) return { ok: false, error: "Missing category." };
  const label = str(formData.get("label"));
  if (!label) return { ok: false, error: "Please enter a category name." };
  const icon = str(formData.get("icon")) ?? "📄";

  const admin = createAdminClient();
  const { error: dbErr } = await admin
    .from("resource_category")
    .update({ label, icon })
    .eq("key", key);
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.category_updated",
    entity: "resource_category",
    summary: `Renamed resource category "${key}" to "${label}"`,
    metadata: { key, label, icon },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Delete a category. Blocked while it still holds documents. Editors only. */
export async function deleteResourceCategory(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };
  if (!canEditGeneral(current.appUser)) {
    return {
      ok: false,
      error: "You don't have permission to delete categories.",
    };
  }

  const key = str(formData.get("key"));
  if (!key) return { ok: false, error: "Missing category." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("resource_document")
    .select("id", { count: "exact", head: true })
    .eq("category", key);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This category still has items. Move or delete them first, then delete the category.",
    };
  }

  const { error: dbErr } = await admin
    .from("resource_category")
    .delete()
    .eq("key", key);
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.category_deleted",
    entity: "resource_category",
    summary: `Deleted resource category "${key}"`,
    metadata: { key },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Edit a document/link's metadata. Editors only. */
export async function updateResourceDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };
  if (!canEditGeneral(current.appUser)) {
    return { ok: false, error: "You don't have permission to edit resources." };
  }

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing item." };
  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Please enter a title." };
  const description = str(formData.get("description"));
  const category = str(formData.get("category")) ?? "general";
  const staffOnly = formData.get("staff_only") === "on";

  const admin = createAdminClient();
  if (!(await categoryExists(admin, category))) {
    return { ok: false, error: "Please choose a valid category." };
  }

  const update: Record<string, unknown> = {
    title,
    description,
    category,
    staff_only: staffOnly,
  };

  // Only link entries expose the URL field; files keep their storage_path.
  if (formData.has("source_url")) {
    const sourceUrl = str(formData.get("source_url"));
    if (!sourceUrl) return { ok: false, error: "Please enter a link URL." };
    if (!/^https?:\/\//i.test(sourceUrl)) {
      return { ok: false, error: "Link must start with http:// or https://." };
    }
    update.source_url = sourceUrl;
  }

  const { error: dbErr } = await admin
    .from("resource_document")
    .update(update)
    .eq("id", id);
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.updated",
    entity: "resource_document",
    summary: `Updated resource "${title}" (${category})`,
    metadata: { id, category },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

/** Delete a document/link (and its stored file, if any). Editors only. */
export async function deleteResourceDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };
  if (!canEditGeneral(current.appUser)) {
    return { ok: false, error: "You don't have permission to delete resources." };
  }

  const id = str(formData.get("id"));
  if (!id) return { ok: false, error: "Missing item." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("resource_document")
    .select("storage_path, title")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That item no longer exists." };

  if (row.storage_path) {
    await admin.storage.from(RESOURCES_BUCKET).remove([row.storage_path]);
  }

  const { error: dbErr } = await admin
    .from("resource_document")
    .delete()
    .eq("id", id);
  if (dbErr) return { ok: false, error: dbErr.message };

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "resource.deleted",
    entity: "resource_document",
    summary: `Deleted resource "${row.title}"`,
    metadata: { id },
  });

  revalidatePath("/resources/policies");
  return { ok: true };
}

