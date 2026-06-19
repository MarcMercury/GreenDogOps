"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { RESOURCE_CATEGORY_META } from "@/lib/resources/types";

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

/** Upload a new policy/resource document. Admins and managers only. */
export async function uploadPolicyDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Not signed in." };

  const role = current.appUser.role;
  if (role !== "owner" && role !== "admin" && role !== "manager") {
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

  const category = str(formData.get("category")) ?? "general";
  if (!(category in RESOURCE_CATEGORY_META)) {
    return { ok: false, error: "Please choose a valid category." };
  }

  const title = str(formData.get("title")) ?? file.name;
  const description = str(formData.get("description"));
  const staffOnly = formData.get("staff_only") === "on";

  const admin = createAdminClient();

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
