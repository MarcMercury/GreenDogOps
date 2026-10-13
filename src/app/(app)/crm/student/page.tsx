import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { CrmContact } from "@/lib/crm/types";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import { isPromotedStudent } from "@/lib/crm/promotion";
import { ContactListView } from "../crm-views";

export const dynamic = "force-dynamic";

export default async function StudentCrmPage() {
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
  const { data, error } = await fetchAllRows<CrmContact>((from, to) =>
    supabase
      .from("crm_contact")
      .select("*")
      .eq("contact_type", "student")
      .order("last_name", { ascending: true })
      .range(from, to),
  );

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

  // Promoted students have moved to Recruiting; their CRM record stays as
  // history (reachable from the ATS/HR profile) but leaves this list.
  const all = (data ?? []) as CrmContact[];
  const students = all.filter((c) => !isPromotedStudent(c));

  return (
    <ContactListView
      contacts={students}
      promotedCount={all.length - students.length}
      title="Student CRM"
      description="Students, externs, and program participants"
      icon="🎓"
      variant="student"
      addHref="/crm/contact/new?type=student"
      canEdit={canEdit}
    />
  );
}
