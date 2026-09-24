import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import type { CrmInfluencer } from "@/lib/crm/types";
import type { QrCode, QrForm, QrLead } from "@/lib/marketing/qr";
import { QrPanel } from "@/lib/marketing/qr-panel";
import { InfluencerForm } from "./influencer-form";

export const dynamic = "force-dynamic";

function influencerHeading(i: CrmInfluencer): string {
  const name = i.contact_name && i.contact_name !== "-" ? i.contact_name : null;
  return name ?? i.pet_name ?? (i.instagram_handle ? `@${i.instagram_handle}` : "Influencer");
}

export default async function InfluencerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
  const { data, error } = await supabase
    .from("marketing_influencers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load influencer: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const influencer = data as CrmInfluencer;

  const [qrCodesRes, qrFormsRes, qrLeadsRes] = await Promise.all([
    supabase
      .from("qr_code")
      .select("*")
      .eq("influencer_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("qr_form").select("*").order("name", { ascending: true }),
    supabase
      .from("qr_lead")
      .select("*")
      .eq("influencer_id", id)
      .order("scanned_at", { ascending: false })
      .limit(500),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/crm/influencer"
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to Influencer CRM
      </Link>
      <InfluencerForm influencer={influencer} canEdit={canEdit} />

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-slate-900">
          <span aria-hidden className="mr-1.5">
            🔳
          </span>
          QR code &amp; tracked leads
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          This code is unique to {influencerHeading(influencer)} — every scan and form
          entry is attributed back to them here and in QR Code Mgmt.
        </p>
        <QrPanel
          subject={{ kind: "influencer", id: influencer.id, name: influencerHeading(influencer) }}
          codes={(qrCodesRes.data ?? []) as QrCode[]}
          forms={(qrFormsRes.data ?? []) as QrForm[]}
          leads={(qrLeadsRes.data ?? []) as QrLead[]}
          canEdit={canEdit}
        />
      </section>
    </div>
  );
}
