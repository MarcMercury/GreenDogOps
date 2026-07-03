import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCurrentUser } from "@/lib/auth/session";
import { isEditorRole } from "@/lib/auth/permissions";
import {
  type CrmContact,
  type CrmCeAttendance,
  type CrmCeEvent,
  crmSectionBySlug,
  crmSlugForContactType,
} from "@/lib/crm/types";
import { ContactForm } from "./contact-form";
import { PromoteToRecruiting } from "./promote-controls";
import { CeAttendanceManager } from "./ce-attendance";
import { getStudentFormOptions } from "@/lib/crm/student-form-data";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const current = await getCurrentUser();
  const canEdit = current ? isEditorRole(current.appUser.role) : false;
  const { data, error } = await supabase
    .from("crm_contact")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load contact: {error.message}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const contact = data as CrmContact;
  const section = crmSectionBySlug(crmSlugForContactType(contact.contact_type));

  const formOptions = await getStudentFormOptions();

  // CE attendees track the continuing-education events they're tied to.
  let ceAttendance: CrmCeAttendance[] = [];
  let ceEvents: CrmCeEvent[] = [];
  if (contact.contact_type === "ce_attendee") {
    const [ceRowsRes, ceEventsRes] = await Promise.all([
      fetchAllRows<CrmCeAttendance>((from, to) =>
        supabase
          .from("crm_ce_attendance")
          .select("*")
          .eq("contact_id", contact.id)
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
    ]);
    ceAttendance = (ceRowsRes.data ?? []) as CrmCeAttendance[];
    ceEvents = (ceEventsRes.data ?? []) as CrmCeEvent[];
  }

  // If this student was promoted, route to wherever that person now lives:
  // the HR roster once hired (employee/contractor/former), else the ATS.
  let promotedHref: string | null = null;
  if (contact.promoted_person_id) {
    const { data: promoted } = await supabase
      .from("person")
      .select("status")
      .eq("id", contact.promoted_person_id)
      .maybeSingle();
    const status = (promoted as { status?: string } | null)?.status;
    const inRoster =
      status === "employee" || status === "contractor" || status === "former";
    promotedHref = inRoster
      ? `/hr/${contact.promoted_person_id}`
      : `/ats/${contact.promoted_person_id}`;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={section ? `/crm/${section.slug}` : "/crm"}
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to {section?.title ?? "CRM"}
      </Link>
      {contact.contact_type === "student" &&
        (contact.promoted_person_id ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <p className="text-sm font-medium text-emerald-900">
              ✓ Promoted to the Recruiting CRM
              {contact.promoted_at
                ? ` on ${new Date(contact.promoted_at).toLocaleDateString()}`
                : ""}
            </p>
            <Link
              href={promotedHref ?? `/ats/${contact.promoted_person_id}`}
              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50"
            >
              Open record →
            </Link>
          </div>
        ) : (
          canEdit && <PromoteToRecruiting contactId={contact.id} />
        ))}
      <ContactForm contact={contact} canEdit={canEdit} options={formOptions} />
      {contact.contact_type === "ce_attendee" && (
        <div className="mt-5">
          <CeAttendanceManager
            contactId={contact.id}
            records={ceAttendance}
            events={ceEvents}
            canEdit={canEdit}
          />
        </div>
      )}
    </div>
  );
}
