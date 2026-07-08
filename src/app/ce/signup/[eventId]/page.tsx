import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { CeSignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function CeSignupPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_ce_event")
    .select("id, name, status")
    .eq("id", eventId)
    .maybeSingle();

  const event = data as { id: string; name: string; status: string | null } | null;
  if (!event) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <CeSignupForm eventId={event.id} eventName={event.name} />
        <p className="mt-6 text-center text-xs text-slate-400">
          Green Dog Ops · Continuing Education
        </p>
      </div>
    </main>
  );
}
