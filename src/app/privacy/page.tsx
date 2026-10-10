import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Green Dog Dental",
  description:
    "Privacy policy for Green Dog Dental (Mobile Vet Services, LLC): job applications, recruiting and HR text messages, and the Green Dog Ops app.",
};

const link = "text-emerald-700 underline";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: October 10, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section className="space-y-2">
          <p>
            This policy explains how Mobile Vet Services, LLC, doing business as
            Green Dog Dental (&ldquo;Green Dog,&rdquo; &ldquo;we,&rdquo;
            &ldquo;us&rdquo;), collects, uses and protects information on
            greendogops.com. That includes our public job application, interview
            scheduling and questionnaire pages, our recruiting and HR text
            messages, and Green Dog Ops, the internal operations app our staff
            use.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Information we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Job applicants:</strong> the information you give us when
              you apply, schedule an interview or complete a questionnaire, such
              as your name, email, mobile phone number, city or ZIP code, resume,
              work history and answers to application questions, plus whether
              you agreed to receive text messages.
            </li>
            <li>
              <strong>Text messages:</strong> your mobile number, the messages
              we send you and your replies, delivery status, and any opt-out
              (STOP) request.
            </li>
            <li>
              <strong>Employees and staff users:</strong> work records needed to
              run our clinics, such as contact details, schedules and HR records,
              and sign-in information for staff who use Green Dog Ops.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">How we use it</h2>
          <p>
            We use this information only to review applications and hire, to
            schedule and remind you about interviews, to communicate with
            employees about work, and to operate and secure our systems. We do
            not sell personal information, and we do not use it for advertising.
          </p>
        </section>

        <section className="space-y-2" id="sms">
          <h2 className="text-base font-semibold text-slate-900">Text messages (SMS)</h2>
          <p>
            Green Dog Dental Recruiting &amp; HR texts job applicants who opt in
            on our application, and employees who agree in writing, about
            recruiting and work matters such as interview scheduling, reminders,
            schedule changes and HR notices. Opting in is optional and is never a
            condition of applying or of employment. Message frequency varies.
            Message and data rates may apply. Reply STOP to opt out at any time,
            or HELP for help.
          </p>
          <p>
            <strong>
              No mobile information will be shared with third parties or
              affiliates for marketing or promotional purposes. Text messaging
              originator opt-in data and consent will not be shared with any
              third parties.
            </strong>{" "}
            We share your number and messages only with the service provider that
            delivers our texts (Twilio), and only so it can deliver them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Who we share it with</h2>
          <p>
            We use service providers to host our systems, send email and deliver
            text messages. They may use your information only to provide those
            services to us. We may also disclose information if the law requires
            it. Apart from that, we do not share your personal information with
            third parties.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Google data (staff only)</h2>
          <p>
            With a staff member&rsquo;s consent, Green Dog Ops connects to Google
            through OAuth. It reads only specific notification emails, such as
            When I Work time-off notices and job-applicant messages, to update our
            HR and recruiting records. For staff who connect their Google
            Calendar, it reads free/busy times and adds booked interviews. It
            requests the minimum access needed and never reads unrelated mail. Our
            use of information received from Google APIs adheres to the{" "}
            <a
              className={link}
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. You can revoke access at
            any time at{" "}
            <a className={link} href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Security and retention</h2>
          <p>
            Access to personal information is limited to authorized Green Dog
            staff who need it for their work. We keep applicant and employee
            records only as long as we need them for hiring, employment and legal
            purposes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Your choices</h2>
          <p>
            Reply STOP to any text to stop receiving them. To ask what
            information we hold about you, or to ask us to correct or delete it,
            email us at the address below.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Contact</h2>
          <p>
            Mobile Vet Services, LLC, dba Green Dog Dental ·{" "}
            <a className={link} href="mailto:marcm@greendogdental.com">
              marcm@greendogdental.com
            </a>{" "}
            ·{" "}
            <a className={link} href="https://www.greendogdental.com" target="_blank" rel="noreferrer">
              greendogdental.com
            </a>
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm">
        <Link className={link} href="/terms">
          Terms of Service &amp; SMS Terms
        </Link>
      </p>
    </main>
  );
}
