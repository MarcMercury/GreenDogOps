import { createClient } from "@/lib/supabase/server";
import type { CrmContact, CrmCeAttendance } from "@/lib/crm/types";
import { CeCrmTabs } from "./ce-tabs";

export const dynamic = "force-dynamic";

export default async function CeLeadsCrmPage() {
  const supabase = await createClient();
  const [contactsRes, attendanceRes] = await Promise.all([
    supabase
      .from("crm_contact")
      .select("*")
      .eq("contact_type", "ce_attendee")
      .order("last_name", { ascending: true })
      .limit(5000),
    supabase
      .from("crm_ce_attendance")
      .select("*")
      .order("ce_date", { ascending: false })
      .limit(20000),
  ]);

  if (contactsRes.error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">CE Leads</h1>
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
    />
  );
}
