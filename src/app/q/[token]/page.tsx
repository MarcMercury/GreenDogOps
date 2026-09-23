import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFormFields, qrFormTheme, type QrFormField } from "@/lib/marketing/qr";
import { CaptureForm } from "@/lib/marketing/capture-form";
import { submitQrLead } from "./actions";

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
  label: string;
  active: boolean;
  target_url: string | null;
  qr_form: FormRow | FormRow[] | null;
};

export default async function QrScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("qr_code")
    .select(
      "label, active, target_url, qr_form(headline, intro, success_message, collect_pet_name, collect_zip, fields, theme, banner_url, active)",
    )
    .eq("token", token)
    .maybeSingle();

  const code = data as CodeRow | null;
  if (!code || !code.active) notFound();

  // Best-effort counter; a failed bump must never block the scan.
  await admin.rpc("record_qr_scan", { p_token: token });

  // A code can simply point somewhere (a landing page, an RSVP link). Only
  // http(s) is followed — the column is free text.
  if (code.target_url && /^https?:\/\//i.test(code.target_url)) {
    redirect(code.target_url);
  }

  const form = Array.isArray(code.qr_form) ? code.qr_form[0] : code.qr_form;
  if (!form || !form.active) notFound();

  const fields: QrFormField[] = parseFormFields(form.fields);

  return (
    <main
      className={`flex min-h-screen items-center justify-center px-4 py-12 ${qrFormTheme(form.theme).page}`}
    >
      <div className="w-full max-w-md">
        <CaptureForm
          eyebrow="You scanned"
          title={form.headline ?? code.label}
          intro={form.intro}
          successMessage={form.success_message}
          collectPetName={form.collect_pet_name}
          collectZip={form.collect_zip}
          fields={fields}
          theme={form.theme}
          bannerUrl={form.banner_url}
          action={submitQrLead.bind(null, token)}
        />
        <p className="mt-6 text-center text-xs text-slate-400">Green Dog Dental</p>
      </div>
    </main>
  );
}
