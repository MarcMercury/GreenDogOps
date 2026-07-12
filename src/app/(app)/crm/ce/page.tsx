import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { CrmContact, CrmCeAttendance, CrmCeEvent } from "@/lib/crm/types";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import { CeCrmTabs } from "./ce-tabs";

export const dynamic = "force-dynamic";

export default async function CeLeadsCrmPage() {
  const supabase = await createClient();
  const [contactsRes, attendanceRes, eventsRes, current] = await Promise.all([
    fetchAllRows<CrmContact>((from, to) =>
      supabase
        .from("crm_contact")
        .select("*")
        .eq("contact_type", "ce_attendee")
        .order("last_name", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<CrmCeAttendance>((from, to) =>
      supabase
        .from("crm_ce_attendance")
        .select("*")
        .order("ce_date", { ascending: false })
        .range(from, to),
    ),
    fetchAllRows<CrmCeEvent>((from, to) =>
      supabase
        .from("crm_ce_event")
        .select("*")
        .order("event_date", { ascending: false })
        .range(from, to),
    ),
    getCurrentUser(),
  ]);

  const canEdit = current ? canEditGeneral(current.appUser) : false;

  if (contactsRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">CE Leads/Events</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load CE leads: {contactsRes.error.message}
        </p>
      </div>
    );
  }

  return (
    <CeCrmTabs
      contacts={(contactsRes.data ?? []) as CrmContact[]}
      attendance={(attendanceRes.data ?? []) as CrmCeAttendance[]}
      events={(eventsRes.data ?? []) as CrmCeEvent[]}
      canEdit={canEdit}
    />
  );
}
