import { createClient } from "@/lib/supabase/server";
import type { CrmContact } from "@/lib/crm/types";
import { ContactListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function StudentCrmPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_contact")
    .select("*")
    .eq("contact_type", "student")
    .order("last_name", { ascending: true });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-slate-900">Student CRM</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load students: {error.message}
        </p>
      </div>
    );
  }

  return (
    <ContactListView
      contacts={(data ?? []) as CrmContact[]}
      title="Student CRM"
      description="Students, externs, and program participants"
      icon="🎓"
      variant="student"
      addHref="/crm/contact/new?type=student"
    />
  );
}
