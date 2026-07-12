import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditGeneral } from "@/lib/auth/permissions";
import {
  type ContactType,
  CONTACT_TYPE_LABELS,
  crmSlugForContactType,
  crmSectionBySlug,
} from "@/lib/crm/types";
import { ContactForm } from "../[id]/contact-form";
import { getStudentFormOptions } from "@/lib/crm/student-form-data";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const contactType = (type ?? "student") as ContactType;
  if (!(contactType in CONTACT_TYPE_LABELS)) notFound();

  const section = crmSectionBySlug(crmSlugForContactType(contactType));

  const current = await getCurrentUser();
  const canEdit = current ? canEditGeneral(current.appUser) : false;
  if (!canEdit) redirect(section ? `/crm/${section.slug}` : "/crm");

  const formOptions = await getStudentFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={section ? `/crm/${section.slug}` : "/crm"}
        className="text-sm text-emerald-700 hover:text-emerald-900"
      >
        ← Back to {section?.title ?? "CRM"}
      </Link>
      <ContactForm mode="create" contactType={contactType} canEdit={canEdit} options={formOptions} />
    </div>
  );
}
