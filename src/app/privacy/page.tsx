import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Green Dog Ops",
  description: "Privacy policy for the Green Dog Ops internal operations app.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: October 9, 2026</p>

      <div className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          Green Dog Ops is a private, internal tool used only by authorized Green
          Dog Dental staff. It is not offered to the public.
        </p>
        <p>
          <strong>Google data.</strong> With your consent, the app connects to
          Google (Gmail) via OAuth to read only specific notification emails —
          such as When I Work time-off notices and job-applicant messages — so it
          can update our internal HR and recruiting records automatically. It
          requests the minimum access needed and never reads unrelated mail.
        </p>
        <p>
          <strong>Use of data.</strong> We do not sell or share this data, and we
          do not use it for advertising. Our use of information received from
          Google APIs adheres to the{" "}
          <a
            className="text-emerald-700 underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          <strong>Text messages (SMS).</strong> Green Dog Dental (Mobile Vet
          Services, LLC, doing business as Green Dog Dental) texts job
          candidates who opt in on our application, and employees who give
          consent, about recruiting and work matters (for example interview
          scheduling, reminders and shift updates). We use your mobile number only
          to send these messages and to record your replies. No mobile
          information will be shared with third parties or affiliates for
          marketing or promotional purposes. Text messaging originator opt-in
          data and consent will not be shared with any third parties, except
          the service providers that deliver the messages (Twilio). Reply STOP
          to opt out at any time, or HELP for help.
        </p>
        <p>
          <strong>Your control.</strong> You can revoke the app&rsquo;s access at
          any time at{" "}
          <a
            className="text-emerald-700 underline"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>
        <p>
          <strong>Contact.</strong> Questions? Email{" "}
          <a className="text-emerald-700 underline" href="mailto:marcm@greendogdental.com">
            marcm@greendogdental.com
          </a>
          .
        </p>
      </div>

      <p className="mt-10 text-sm">
        <Link className="text-emerald-700 underline" href="/terms">
          Terms of Service
        </Link>
      </p>
    </main>
  );
}
