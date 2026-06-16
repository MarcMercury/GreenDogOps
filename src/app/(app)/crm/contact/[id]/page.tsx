import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CrmContact } from "@/lib/crm/types";
import { ContactForm } from "./contact-form";

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

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/crm" className="text-sm text-emerald-700 hover:text-emerald-900">
        ← Back to CRM
      </Link>
      <ContactForm contact={data as CrmContact} />
    </div>
  );
}
