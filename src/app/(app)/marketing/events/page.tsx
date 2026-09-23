import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import type {
  MarketingEvent,
  MarketingEventSource,
  MarketingEventAttendee,
  PersonOption,
  CrmOrgRef,
} from "@/lib/marketing/types";
import type { QrCode, QrForm, QrLead } from "@/lib/marketing/qr";
import type { CeEventSummary } from "@/lib/marketing/event-rows";
import { EventsWorkspace } from "./events-workspace";

const CE_COLUMNS =
  "id, name, event_date, end_date, start_time, end_time, location, subject, presenters, description, audience, status, capacity, cost_type, cost_amount, registration_url, approval_board, approval_status, race_approved, ce_hours_total";

export const dynamic = "force-dynamic";

export default async function EventManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditModule(current.appUser, "marketing") : false;

  const [eventsRes, sourcesRes, attendeesRes, peopleRes, crmOrgsRes, qrCodesRes, qrFormsRes, leadsRes, ceRes] =
    await Promise.all([
      supabase
        .from("marketing_event")
        .select("*")
        .order("starts_on", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
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
        .from("person")
        .select("id, full_name, first_name, last_name")
        .in("status", ["employee", "contractor"])
        .order("full_name", { ascending: true }),
      supabase
        .from("crm_organization")
        .select("id, name, org_type, subtype")
        .in("org_type", [
          "marketing_partner",
          "facility_resource",
          "med_ops",
          "office_marketing",
        ])
        .order("name", { ascending: true }),
      supabase
        .from("qr_code")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("qr_form")
        .select("*")
        .order("name", { ascending: true }),
      supabase
        .from("qr_lead")
        .select("*")
        .order("scanned_at", { ascending: false })
        .limit(2000),
      // CE courses are projected in, never copied — /crm/ce stays the editor.
      supabase
        .from("crm_ce_event")
        .select(CE_COLUMNS)
        .order("event_date", { ascending: true, nullsFirst: false }),
    ]);

  const firstError =
    eventsRes.error ||
    sourcesRes.error ||
    attendeesRes.error ||
    peopleRes.error ||
    crmOrgsRes.error ||
    qrCodesRes.error ||
    qrFormsRes.error ||
    leadsRes.error ||
    ceRes.error;

  if (firstError) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Event Management</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load events: {firstError.message}
        </p>
      </div>
    );
  }

  return (
    <EventsWorkspace
      canEdit={canEdit}
      events={(eventsRes.data ?? []) as MarketingEvent[]}
      ceEvents={(ceRes.data ?? []) as CeEventSummary[]}
      sources={(sourcesRes.data ?? []) as MarketingEventSource[]}
      attendees={(attendeesRes.data ?? []) as MarketingEventAttendee[]}
      people={(peopleRes.data ?? []) as PersonOption[]}
      crmOrgs={(crmOrgsRes.data ?? []) as CrmOrgRef[]}
      qrCodes={(qrCodesRes.data ?? []) as QrCode[]}
      qrForms={(qrFormsRes.data ?? []) as QrForm[]}
      leads={(leadsRes.data ?? []) as QrLead[]}
      initialView={view}
    />
  );
}
