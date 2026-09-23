import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFormFields, qrFormTheme } from "@/lib/marketing/qr";
import { CaptureForm } from "@/lib/marketing/capture-form";
import { submitRetailLead } from "./actions";

export const dynamic = "force-dynamic";

type FormRow = {
  headline: string | null;
  intro: string | null;
  success_message: string | null;
  collect_pet_name: boolean;
  collect_zip: boolean;
  fields: unknown;
  theme: string | null;
  banner_url: string | null;
  active: boolean;
};

type CodeRow = {
  active: boolean;
  target_url: string | null;
  qr_form: FormRow | FormRow[] | null;
};

export default async function RetailLeadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_organization")
    .select("name")
    .eq("qr_token", token)
    .maybeSingle();

  const partner = data as { name: string } | null;
  if (!partner) notFound();

  // Migration 0208 gave every partner a qr_code row keyed by this same token,
  // so a code that has been assigned a form in QR Code Mgmt renders it here.
  // Partners whose code was never touched keep the plain contact form.
  const { data: codeData } = await admin
    .from("qr_code")
    .select(
      "active, target_url, qr_form(headline, intro, success_message, collect_pet_name, collect_zip, fields, theme, banner_url, active)",
    )
    .eq("token", token)
    .maybeSingle();

  const code = codeData as CodeRow | null;
  if (code && !code.active) notFound();
  if (code) await admin.rpc("record_qr_scan", { p_token: token });

  if (code?.target_url && /^https?:\/\//i.test(code.target_url)) {
    redirect(code.target_url);
  }

  const raw = Array.isArray(code?.qr_form) ? code.qr_form[0] : code?.qr_form;
  const form = raw?.active ? raw : null;

  return (
    <main
      className={`flex min-h-screen items-center justify-center px-4 py-12 ${qrFormTheme(form?.theme).page}`}
    >
      <div className="w-full max-w-md">
        <CaptureForm
          eyebrow="You scanned the code at"
          title={form?.headline ?? partner.name}
          intro={
            form?.intro ??
            "Leave your details and the Green Dog Dental team will reach out about caring for your pet."
          }
          successMessage={
            form?.success_message ??
            `Green Dog Dental will be in touch shortly. Thanks for visiting ${partner.name}.`
          }
          collectPetName={form ? form.collect_pet_name : true}
          collectZip={form?.collect_zip ?? false}
          fields={parseFormFields(form?.fields)}
          theme={form?.theme ?? null}
          bannerUrl={form?.banner_url ?? null}
          action={submitRetailLead.bind(null, token)}
        />
        <p className="mt-6 text-center text-xs text-slate-400">
          Green Dog Dental · Partner Referral
        </p>
      </div>
    </main>
  );
}
