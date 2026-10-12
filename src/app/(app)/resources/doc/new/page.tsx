import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageDocuments } from "@/lib/resources/access";
import { loadActiveUsers } from "@/lib/resources/server";
import type { ResourceCategory } from "@/lib/resources/types";
import { DocumentEditor } from "../_components/document-editor";

export const dynamic = "force-dynamic";

export default async function NewResourceDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const current = await requireUser();
  if (!canManageDocuments(current.appUser)) redirect("/resources");
  const { category } = await searchParams;

  const admin = createAdminClient();
  const [{ data: cats }, users] = await Promise.all([
    admin
      .from("resource_category")
      .select("key, label, icon, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("label"),
    loadActiveUsers(admin),
  ]);
  const categories = (cats ?? []) as ResourceCategory[];
  const initialCategory =
    categories.find((c) => c.key === category)?.key ?? categories.find((c) => c.key === "hr")?.key ?? categories[0]?.key ?? "general";

  return (
    <DocumentEditor
      initial={{
        id: null,
        title: "",
        category: initialCategory,
        description: "",
        content: null,
        baseVersion: 0,
        requireSignature: false,
      }}
      categories={categories}
      audienceCount={users.filter((u) => u.id !== current.authId).length}
      people={users.map((u) => ({ id: u.id, name: u.full_name?.trim() || u.email, role: u.role }))}
      selfId={current.authId}
    />
  );
}
