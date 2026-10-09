import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Green Dog Ops",
  description: "Terms of service for the Green Dog Ops internal operations app.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Terms of Service</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: October 9, 2026</p>

      <div className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          Green Dog Ops is an internal application for authorized Green Dog Dental
          personnel only. Access is granted by the company and may be changed or
          revoked at any time.
        </p>
        <p>
          Use the app only for legitimate Green Dog Dental business and in
          accordance with company policies. Do not share your login or misuse any
          data you can access.
        </p>
        <p>
          The app is provided &ldquo;as is,&rdquo; without warranties of any kind.
          Green Dog Dental is not liable for any damages arising from its use.
        </p>
        <p>
          <strong>Text messaging terms.</strong> Green Dog Dental Recruiting &amp;
          HR texts are sent to job candidates who check &ldquo;Text me about my
          application&rdquo; on our application, and to employees who agree to
          receive work texts. Messages cover recruiting and employment matters
          such as interview scheduling, reminders and shift updates. Message
          frequency varies. Message and data rates may apply. Reply{" "}
          <strong>STOP</strong> to cancel at any time; you will receive one
          confirmation and no further messages. Reply <strong>HELP</strong> for
          help, or email marcm@greendogdental.com. Carriers are not liable for
          delayed or undelivered messages. Consent to texts is never a condition
          of applying or of employment. See our{" "}
          <Link className="text-emerald-700 underline" href="/privacy">
            Privacy Policy
          </Link>
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
        <Link className="text-emerald-700 underline" href="/privacy">
          Privacy Policy
        </Link>
      </p>
    </main>
  );
}
