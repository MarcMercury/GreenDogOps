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
  // A code with no (or a retired) form still captures contact details rather
  // than 404-ing — a printed code must never become a dead end.
  const live = form?.active ? form : null;

  const fields: QrFormField[] = parseFormFields(live?.fields);

  return (
    <main
      className={`flex min-h-screen items-center justify-center px-4 py-12 ${qrFormTheme(live?.theme).page}`}
    >
      <div className="w-full max-w-md">
        <CaptureForm
          eyebrow="You scanned"
          title={live?.headline ?? code.label}
          intro={live?.intro ?? null}
          successMessage={live?.success_message ?? null}
          collectPetName={live ? live.collect_pet_name : true}
          collectZip={live?.collect_zip ?? false}
          fields={fields}
          theme={live?.theme ?? null}
          bannerUrl={live?.banner_url ?? null}
          action={submitQrLead.bind(null, token)}
        />
        <p className="mt-6 text-center text-xs text-slate-400">Green Dog Dental</p>
      </div>
    </main>
  );
}
