import { hasAckedNotice } from "@/lib/timeclock/server";
import { TIME_CLOCK_NOTICE, TIME_CLOCK_NOTICE_VERSION } from "@/lib/timeclock/notice";
import { AcceptNoticeButton } from "../accept-notice";
import { loadSelf, selfProblemMessage } from "../self";

export const dynamic = "force-dynamic";

export default async function TimeClockPrivacyPage() {
  const self = await loadSelf();
  const acked = self.ok ? await hasAckedNotice(self.person.id) : false;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Time clock privacy notice</h2>
        <p className="text-xs text-slate-400">Version {TIME_CLOCK_NOTICE_VERSION}</p>
      </div>
      <dl className="space-y-3">
        {TIME_CLOCK_NOTICE.map((s) => (
          <div key={s.heading}>
            <dt className="text-sm font-medium text-slate-800">{s.heading}</dt>
            <dd className="text-sm text-slate-600">{s.body}</dd>
          </div>
        ))}
      </dl>
      {!self.ok ? (
        <p className="text-sm text-slate-500">{selfProblemMessage(self.reason)}</p>
      ) : acked ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">You have read this notice.</p>
      ) : (
        <AcceptNoticeButton />
      )}
    </section>
  );
}
