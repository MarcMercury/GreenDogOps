import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule, isAdminRole, canViewCredentials, canAccessModule } from "@/lib/auth/permissions";
import type { EmailTemplate } from "@/lib/crm/email-templates";
import type {
  MarketingEvent,
  MarketingBudgetPeriod,
  MarketingBudgetEntry,
  MarketingResource,
  MarketingTreeNode,
  MarketingPromotion,
  PersonOption,
  MarketingActivity,
  CrmOrgRef,
  MarketingVendorRef,
} from "@/lib/marketing/types";
import { MARKETING_VENDOR_CATEGORY, NON_MED_CATEGORY } from "@/lib/crm/types";
import type { QrCode, QrForm, QrLead } from "@/lib/marketing/qr";
import { MarketingDashboard } from "./marketing-dashboard";
import type { PartnerCodeRow, CeEventRef, RetailLeadRow } from "./qr-codes-workspace";

export const dynamic = "force-dynamic";

export default async function MarketingManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: initialTab } = await searchParams;
  // Events moved to their own page (nav: Event Mgmt); keep old deep links working.
  if (initialTab === "events") redirect("/marketing/events");
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "marketing") : false;
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;
  const canSeeCredentials = current ? canViewCredentials(current.appUser.role) : false;
  const canManageEmailTemplates = current
    ? canAccessModule(current.appUser, "email_templates")
    : false;

  // Email templates are managed here as a tab (Schedule Admins and up).
  const emailTemplates = canManageEmailTemplates
    ? ((
        await createAdminClient()
          .from("email_template")
          .select("*")
          .order("category")
          .order("name")
      ).data ?? []) as EmailTemplate[]
    : [];

  const [
    eventsRes,
    resourcesRes,
    treeRes,
    promotionsRes,
    peopleRes,
    activityRes,
  ] = await Promise.all([
    supabase
      .from("marketing_event")
      .select("*")
      .order("starts_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("marketing_resource")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("marketing_tree_node")
      .select("*")
      .order("zone", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("marketing_promotion")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("person")
      .select("id, full_name, first_name, last_name")
      .in("status", ["employee", "contractor"])
      .order("full_name", { ascending: true }),
    supabase
      .from("marketing_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Vendor & Partner CRM records available for linking Events Scout sources.
  const crmOrgsRes = await supabase
    .from("crm_organization")
    .select("id, name, org_type, subtype")
    .in("org_type", [
      "marketing_partner",
      "facility_resource",
      "med_ops",
      "office_marketing",
    ])
    .order("name", { ascending: true });

  // Marketing Vendors (printing, media, merch, client comms) live in the
  // Resources tab rather than their own nav entry.
  const vendorsRes = await supabase
    .from("crm_organization")
    .select(
      "id, name, subtype, status, contact_name, phone, email, website, account_number, account_rep, notes",
    )
    .eq("category", MARKETING_VENDOR_CATEGORY)
    .order("name", { ascending: true });

  // Budget is admin-only. Non-admins never receive the rows.
  const [periodRes, entriesRes] = isAdmin
    ? await Promise.all([
        supabase
          .from("marketing_budget_period")
          .select("*")
          .order("year", { ascending: false }),
        supabase
          .from("marketing_budget_entry")
          .select("*")
          .order("entry_date", { ascending: false }),
      ])
    : [
        { data: [], error: null } as const,
        { data: [], error: null } as const,
      ];

  // QR Codes tab: managed codes + forms, plus the legacy Non-Med Partner codes
  // that still live on crm_organization.qr_token.
  const [
    qrCodesRes,
    qrFormsRes,
    qrLeadsRes,
    qrEventsRes,
    qrCeRes,
    partnersRes,
    retailLeadsRes,
    qrOrgNamesRes,
    qrReferralNamesRes,
    qrInfluencerNamesRes,
  ] = await Promise.all([
    supabase.from("qr_code").select("*").order("created_at", { ascending: false }),
    supabase.from("qr_form").select("*").order("name", { ascending: true }),
    supabase
      .from("qr_lead")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(5000),
    supabase
      .from("marketing_event")
      .select("id, name, starts_on")
      .order("starts_on", { ascending: false, nullsFirst: false }),
    supabase
      .from("crm_ce_event")
      .select("id, name, event_date")
      .order("event_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("crm_organization")
      .select("id, name, qr_token")
      .eq("category", NON_MED_CATEGORY)
      .order("name", { ascending: true }),
    supabase
      .from("crm_retail_lead")
      .select(
        "id, org_id, full_name, email, phone, pet_name, zip, answers, status, notes, scanned_at",
      )
      .order("scanned_at", { ascending: false })
      .limit(5000),
    // Name lookups for the unified Leads tab — a code can point at any org
    // (retail partner or rescue), a referral clinic or an influencer.
    supabase.from("crm_organization").select("id, name"),
    supabase.from("referral_partners").select("id, name"),
    supabase
      .from("marketing_influencers")
      .select("id, contact_name, pet_name, instagram_handle"),
  ]);

  const retailLeads = (retailLeadsRes.data ?? []) as RetailLeadRow[];
  const retailCounts = new Map<string, number>();
  for (const l of retailLeads) {
    retailCounts.set(l.org_id, (retailCounts.get(l.org_id) ?? 0) + 1);
  }

  // id → display name for every record a QR code can belong to.
  const qrSourceNames: [string, string][] = [
    ...((qrEventsRes.data ?? []) as { id: string; name: string }[]).map(
      (e) => [e.id, e.name] as [string, string],
    ),
    ...((qrCeRes.data ?? []) as { id: string; name: string }[]).map(
      (e) => [e.id, `CE: ${e.name}`] as [string, string],
    ),
    ...((promotionsRes.data ?? []) as { id: string; name: string }[]).map(
      (p) => [p.id, p.name] as [string, string],
    ),
    ...((qrOrgNamesRes.data ?? []) as { id: string; name: string }[]).map(
      (o) => [o.id, o.name] as [string, string],
    ),
    ...((qrReferralNamesRes.data ?? []) as { id: string; name: string }[]).map(
      (p) => [p.id, p.name] as [string, string],
    ),
    ...(
      (qrInfluencerNamesRes.data ?? []) as {
        id: string;
        contact_name: string | null;
        pet_name: string | null;
        instagram_handle: string | null;
      }[]
    ).map((i) => {
      // "-" is the placeholder the influencer import left in contact_name.
      const name =
        (i.contact_name && i.contact_name !== "-" ? i.contact_name : null) ??
        i.pet_name ??
        (i.instagram_handle ? `@${i.instagram_handle}` : "Influencer");
      return [i.id, name] as [string, string];
    }),
  ];
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

  const firstError =
    eventsRes.error ||
    periodRes.error ||
    entriesRes.error ||
    resourcesRes.error ||
    treeRes.error ||
    promotionsRes.error ||
    crmOrgsRes.error ||
    vendorsRes.error ||
    qrCodesRes.error ||
    qrFormsRes.error ||
    qrLeadsRes.error ||
    qrCeRes.error;

  if (firstError) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">
          Marketing Management
        </h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load marketing data: {firstError.message}
        </p>
      </div>
    );
  }

  return (
    <MarketingDashboard
      canEdit={canEdit}
      isAdmin={isAdmin}
      canViewCredentials={canSeeCredentials}
      events={(eventsRes.data ?? []) as MarketingEvent[]}
      budgetPeriods={(periodRes.data ?? []) as MarketingBudgetPeriod[]}
      budgetEntries={(entriesRes.data ?? []) as MarketingBudgetEntry[]}
      resources={(resourcesRes.data ?? []) as MarketingResource[]}
      treeNodes={(treeRes.data ?? []) as MarketingTreeNode[]}
      promotions={(promotionsRes.data ?? []) as MarketingPromotion[]}
      people={(peopleRes.data ?? []) as PersonOption[]}
      activity={(activityRes.data ?? []) as MarketingActivity[]}
      crmOrgs={(crmOrgsRes.data ?? []) as CrmOrgRef[]}
      marketingVendors={(vendorsRes.data ?? []) as MarketingVendorRef[]}
      emailTemplates={emailTemplates}
      canManageEmailTemplates={canManageEmailTemplates}
      qrCodes={(qrCodesRes.data ?? []) as QrCode[]}
      qrForms={(qrFormsRes.data ?? []) as QrForm[]}
      qrLeads={(qrLeadsRes.data ?? []) as QrLead[]}
      qrRetailLeads={retailLeads}
      qrSourceNames={qrSourceNames}
      qrEvents={(qrEventsRes.data ?? []) as Pick<MarketingEvent, "id" | "name" | "starts_on">[]}
      qrCeEvents={(qrCeRes.data ?? []) as CeEventRef[]}
      partnerCodes={partnerCodes}
      initialTab={initialTab}
    />
  );
}
