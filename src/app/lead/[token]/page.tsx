import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { RetailLeadForm } from "./lead-form";

export const dynamic = "force-dynamic";

export default async function RetailLeadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_organization")
    .select("name")
    .eq("qr_token", token)
    .maybeSingle();

  const partner = data as { name: string } | null;
  if (!partner) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <RetailLeadForm token={token} partnerName={partner.name} />
        <p className="mt-6 text-center text-xs text-slate-400">
          Green Dog Dental · Partner Referral
        </p>
      </div>
    </main>
  );
}
