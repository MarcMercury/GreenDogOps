import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  type CrmContact,
  crmSectionBySlug,
  crmSlugForContactType,
} from "@/lib/crm/types";
import { ContactForm } from "./contact-form";
import { PromoteToRecruiting } from "./promote-controls";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
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
              href={`/ats/${contact.promoted_person_id}`}
              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50"
            >
              Open recruiting record →
            </Link>
          </div>
        ) : (
          <PromoteToRecruiting contactId={contact.id} />
        ))}
      <ContactForm contact={contact} />
    </div>
  );
}
