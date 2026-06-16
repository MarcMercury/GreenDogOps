import { createClient } from "@/lib/supabase/server";
import type { CrmContact } from "@/lib/crm/types";
import { ContactListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function CeLeadsCrmPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_contact")
    .select("*")
    .eq("contact_type", "ce_attendee")
    .order("last_name", { ascending: true });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">CE Leads</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load CE leads: {error.message}
        </p>
      </div>
    );
  }

  return (
    <ContactListView
      contacts={(data ?? []) as CrmContact[]}
      title="CE Leads"
      description="Continuing-education event attendees & leads"
      icon="📋"
      variant="ce"
    />
  );
}
