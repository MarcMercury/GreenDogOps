import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule, isAdminRole, canViewCredentials } from "@/lib/auth/permissions";
import type {
  MarketingGoal,
  MarketingInitiative,
  MarketingEvent,
  MarketingBudgetPeriod,
  MarketingBudgetEntry,
  MarketingResource,
  MarketingTreeNode,
  MarketingEventSource,
  MarketingEventAttendee,
  MarketingPromotion,
  PersonOption,
  MarketingActivity,
  CrmOrgRef,
} from "@/lib/marketing/types";
import { MarketingDashboard } from "./marketing-dashboard";

export const dynamic = "force-dynamic";

export default async function MarketingManagementPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "marketing") : false;
  const isAdmin = current ? isAdminRole(current.appUser.role) : false;
  const canSeeCredentials = current ? canViewCredentials(current.appUser.role) : false;

  const [
    goalsRes,
    initiativesRes,
    eventsRes,
    resourcesRes,
    treeRes,
    sourcesRes,
    attendeesRes,
    promotionsRes,
    peopleRes,
    activityRes,
  ] = await Promise.all([
    supabase
      .from("marketing_goal")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("marketing_initiative")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
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
      .from("marketing_event_source")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("marketing_event_attendee")
      .select("*")
      .order("created_at", { ascending: true }),
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

  const firstError =
    goalsRes.error ||
    initiativesRes.error ||
    eventsRes.error ||
    periodRes.error ||
    entriesRes.error ||
    resourcesRes.error ||
    treeRes.error ||
    sourcesRes.error ||
    attendeesRes.error ||
    promotionsRes.error ||
    crmOrgsRes.error;

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
      goals={(goalsRes.data ?? []) as MarketingGoal[]}
      initiatives={(initiativesRes.data ?? []) as MarketingInitiative[]}
      events={(eventsRes.data ?? []) as MarketingEvent[]}
      budgetPeriods={(periodRes.data ?? []) as MarketingBudgetPeriod[]}
      budgetEntries={(entriesRes.data ?? []) as MarketingBudgetEntry[]}
      resources={(resourcesRes.data ?? []) as MarketingResource[]}
      treeNodes={(treeRes.data ?? []) as MarketingTreeNode[]}
      eventSources={(sourcesRes.data ?? []) as MarketingEventSource[]}
      eventAttendees={(attendeesRes.data ?? []) as MarketingEventAttendee[]}
      promotions={(promotionsRes.data ?? []) as MarketingPromotion[]}
      people={(peopleRes.data ?? []) as PersonOption[]}
      activity={(activityRes.data ?? []) as MarketingActivity[]}
      crmOrgs={(crmOrgsRes.data ?? []) as CrmOrgRef[]}
    />
  );
}
