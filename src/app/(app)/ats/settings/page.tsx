import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import type { EmailTemplate } from "@/lib/ats/rejections";
import { TemplatesEditor } from "./templates-editor";

export const dynamic = "force-dynamic";

export default async function AtsSettingsPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const canEdit = canEditModule(current.appUser, "ats");
  const supabase = await createClient();
  const { data } = await supabase
    .from("recruiting_email_template")
    .select("id, kind, name, subject, body, active, sort_order")
    .eq("kind", "rejection")
    .order("sort_order");

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/ats" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to recruiting
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Recruiting Settings</h1>
      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Rejection Templates</h2>
      <p className="mt-1 text-sm text-slate-500">
        Picked when someone clicks Reject. The email goes out 48 hours later unless it&apos;s cancelled or the
        rejection is undone from the Rejected queue. Use <code>{"{first_name}"}</code>, <code>{"{full_name}"}</code>{" "}
        and <code>{"{role}"}</code>; a &ldquo;— The Green Dog Team&rdquo; sign-off is added automatically.
      </p>
      <TemplatesEditor templates={(data ?? []) as EmailTemplate[]} canEdit={canEdit} />
    </div>
  );
}
