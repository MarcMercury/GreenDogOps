import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFormFields, type QrFormField } from "@/lib/marketing/qr";
import { QrCaptureForm } from "./qr-form";

export const dynamic = "force-dynamic";

type FormRow = {
  headline: string | null;
  intro: string | null;
  success_message: string | null;
  collect_pet_name: boolean;
  collect_zip: boolean;
  fields: unknown;
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
      "label, active, target_url, qr_form(headline, intro, success_message, collect_pet_name, collect_zip, fields, active)",
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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <QrCaptureForm
          token={token}
          label={code.label}
          headline={form.headline}
          intro={form.intro}
          successMessage={form.success_message}
          collectPetName={form.collect_pet_name}
          collectZip={form.collect_zip}
          fields={fields}
        />
        <p className="mt-6 text-center text-xs text-slate-400">Green Dog Dental</p>
      </div>
    </main>
  );
}
