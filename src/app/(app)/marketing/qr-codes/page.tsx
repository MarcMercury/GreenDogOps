import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { NON_MED_CATEGORY } from "@/lib/crm/types";
import type { MarketingEvent, MarketingPromotion } from "@/lib/marketing/types";
import type { QrCode, QrForm, QrLead } from "@/lib/marketing/qr";
import { QrCodesWorkspace, type PartnerCodeRow, type CeEventRef } from "./qr-codes-workspace";

export const dynamic = "force-dynamic";

export default async function QrCodeManagementPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "marketing") : false;

  const [codesRes, formsRes, leadsRes, eventsRes, promosRes, partnersRes, retailLeadsRes, ceRes] =
    await Promise.all([
      supabase.from("qr_code").select("*").order("created_at", { ascending: false }),
      supabase.from("qr_form").select("*").order("name", { ascending: true }),
      supabase
        .from("qr_lead")
        .select("id, qr_code_id, scanned_at")
        .order("scanned_at", { ascending: false })
        .limit(5000),
      supabase
        .from("marketing_event")
        .select("id, name, starts_on")
        .order("starts_on", { ascending: false, nullsFirst: false }),
      supabase
        .from("marketing_promotion")
        .select("id, name")
        .order("name", { ascending: true }),
      supabase
        .from("crm_organization")
        .select("id, name, qr_token")
        .eq("category", NON_MED_CATEGORY)
        .order("name", { ascending: true }),
      supabase.from("crm_retail_lead").select("id, org_id").limit(5000),
      supabase
        .from("crm_ce_event")
        .select("id, name, event_date")
        .order("event_date", { ascending: false, nullsFirst: false }),
    ]);

  const firstError =
    codesRes.error || formsRes.error || leadsRes.error || eventsRes.error || promosRes.error || ceRes.error;
  if (firstError) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">QR Code Management</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load QR codes: {firstError.message}
        </p>
      </div>
    );
  }

  // Legacy Non-Med Partner codes still live on crm_organization.qr_token and
  // point at /lead/<token>. They are listed read-only here rather than migrated
  // so every already-printed partner code keeps working.
  const retailCounts = new Map<string, number>();
  for (const l of (retailLeadsRes.data ?? []) as { org_id: string }[]) {
    retailCounts.set(l.org_id, (retailCounts.get(l.org_id) ?? 0) + 1);
  }
  const partnerCodes: PartnerCodeRow[] = (
    (partnersRes.data ?? []) as { id: string; name: string; qr_token: string | null }[]
  )
    .filter((p) => p.qr_token)
    .map((p) => ({
      id: p.id,
      name: p.name,
      token: p.qr_token as string,
      leads: retailCounts.get(p.id) ?? 0,
    }));

  return (
    <QrCodesWorkspace
      canEdit={canEdit}
      codes={(codesRes.data ?? []) as QrCode[]}
      forms={(formsRes.data ?? []) as QrForm[]}
      leads={(leadsRes.data ?? []) as Pick<QrLead, "id" | "qr_code_id" | "scanned_at">[]}
      events={(eventsRes.data ?? []) as Pick<MarketingEvent, "id" | "name" | "starts_on">[]}
      promotions={(promosRes.data ?? []) as Pick<MarketingPromotion, "id" | "name">[]}
      ceEvents={(ceRes.data ?? []) as CeEventRef[]}
      partnerCodes={partnerCodes}
    />
  );
}
