// Resource library types. The old hard-coded Google Docs quick-links were
// replaced by native Ops documents (migration 0235, import_google_docs_native.mjs).

export interface ResourceDocument {
  id: string;
  title: string;
  category: string;
  description: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source_url: string | null;
  staff_only: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Native documents, access and signatures (migration 0235).
  /** NULL = everyone; [] = only named viewers. HR / Manager and above see all. */
  visible_roles: string[] | null;
  current_version: number;
  require_signature: boolean;
  signature_from_version: number | null;
  google_file_id: string | null;
  /** Only loaded on the document page (it can be large). */
  content_json?: unknown;
  content_text?: string | null;
  /** Set by list queries: true when the row has a native body. */
  is_native?: boolean;
}

/** List columns — everything except the (large) native body. */
export const RESOURCE_LIST_COLUMNS =
  "id, title, category, description, storage_path, file_name, mime_type, size_bytes, source_url, staff_only, sort_order, is_active, created_at, updated_at, visible_roles, current_version, require_signature, signature_from_version, google_file_id, native:content_json->>type";

export type ResourceKind = "native" | "file" | "link";

export function resourceKind(
  doc: Pick<ResourceDocument, "storage_path" | "content_json" | "is_native">,
): ResourceKind {
  if (doc.is_native || doc.content_json) return "native";
  return doc.storage_path ? "file" : "link";
}

/** In-app page for native and uploaded documents; links go straight out. */
export function resourceHref(
  doc: Pick<ResourceDocument, "id" | "storage_path" | "source_url" | "content_json" | "is_native">,
): string | null {
  return resourceKind(doc) === "link" ? doc.source_url : `/resources/doc/${doc.id}`;
}

export interface ResourceDocumentWithUrl extends ResourceDocument {
  /** Where the library item opens: the in-app document page, or the external link. */
  signed_url: string | null;
  /** The viewer's own signature state for this document. */
  my_signature?: "not_required" | "signed" | "pending";
}

/** A document category from greendogops.resource_category (admin-manageable). */
export interface ResourceCategory {
  key: string;
  label: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Fallback display label + icon per document category. The live catalog now
 * lives in greendogops.resource_category; this map is only used as a default
 * when a category has no matching row (e.g. legacy data).
 */
export const RESOURCE_CATEGORY_META: Record<
  string,
  { label: string; icon: string }
> = {
  hr: { label: "HR", icon: "👥" },
  safety: { label: "Safety", icon: "🦺" },
  operations: { label: "Operations", icon: "⚙️" },
  marketing: { label: "Marketing & Events", icon: "📣" },
  medical: { label: "Medical & Compliance", icon: "🩺" },
  recruiting: { label: "Recruiting", icon: "🎯" },
  training: { label: "Training", icon: "🎓" },
  forms: { label: "Forms", icon: "📝" },
  general: { label: "General", icon: "📄" },
};

export function resourceCategoryMeta(category: string): {
  label: string;
  icon: string;
} {
  return (
    RESOURCE_CATEGORY_META[category] ?? {
      label: category.charAt(0).toUpperCase() + category.slice(1),
      icon: "📄",
    }
  );
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
