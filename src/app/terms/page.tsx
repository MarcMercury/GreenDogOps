import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service & SMS Terms · Green Dog Dental",
  description:
    "Terms for Green Dog Dental (Mobile Vet Services, LLC) recruiting & HR text messages and the Green Dog Ops app.",
};

const link = "text-emerald-700 underline";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Terms of Service &amp; SMS Terms</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: October 10, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section className="space-y-2" id="sms">
          <h2 className="text-base font-semibold text-slate-900">
            SMS Terms &amp; Conditions: Green Dog Dental Recruiting &amp; HR
          </h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>Program.</strong> Green Dog Dental Recruiting &amp; HR is a
              text messaging program run by Mobile Vet Services, LLC, doing
              business as Green Dog Dental (&ldquo;Green Dog&rdquo;). We send
              recruiting texts to job applicants (application updates, interview
              scheduling and reminders, onboarding steps) and work texts to
              employees (schedule and shift updates, time-off decisions, HR
              notices and reminders). We do not send marketing messages.
            </li>
            <li>
              <strong>How you opt in.</strong> Applicants opt in by checking the
              optional &ldquo;Text me about my application&rdquo; box on our job
              application at{" "}
              <Link className={link} href="/apply">
                greendogops.com/apply
              </Link>
              . Employees opt in by agreeing in writing to receive work texts.
              Consent is never a condition of applying or of employment.
            </li>
            <li>
              <strong>Message frequency</strong> varies with your application or
              work schedule.
            </li>
            <li>
              <strong>Message and data rates may apply.</strong> Check your
              mobile plan for details.
            </li>
            <li>
              <strong>To opt out,</strong> reply <strong>STOP</strong> to any
              message (CANCEL, END, QUIT, UNSUBSCRIBE and STOPALL also work). You
              will receive one message confirming that you are unsubscribed, and
              no further messages. To opt back in, reply <strong>START</strong>.
            </li>
            <li>
              <strong>For help,</strong> reply <strong>HELP</strong> to any
              message, or email{" "}
              <a className={link} href="mailto:marcm@greendogdental.com">
                marcm@greendogdental.com
              </a>
              .
            </li>
            <li>
              <strong>Carriers are not liable</strong> for delayed or undelivered
              messages.
            </li>
            <li>
              <strong>Privacy.</strong> See our{" "}
              <Link className={link} href="/privacy">
                Privacy Policy
              </Link>
              . No mobile information will be shared with third parties or
              affiliates for marketing or promotional purposes.
            </li>
          </ol>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Green Dog Ops app</h2>
          <p>
            Green Dog Ops is Green Dog Dental&rsquo;s internal operations
            application. Staff access is granted by the company for authorized
            personnel only, and may be changed or revoked at any time. Use it
            only for legitimate Green Dog Dental business and in line with
            company policies. Do not share your login or misuse any data you can
            access. Public pages, such as the job application and interview
            scheduling links, may be used only for their intended purpose.
          </p>
          <p>
            The app is provided &ldquo;as is,&rdquo; without warranties of any
            kind. Green Dog Dental is not liable for any damages arising from its
            use.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Contact</h2>
          <p>
            Mobile Vet Services, LLC, dba Green Dog Dental ·{" "}
            <a className={link} href="mailto:marcm@greendogdental.com">
              marcm@greendogdental.com
            </a>
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm">
        <Link className={link} href="/privacy">
          Privacy Policy
        </Link>
      </p>
    </main>
  );
}
