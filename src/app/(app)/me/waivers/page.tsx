import { formatAckTimestamp } from "@/lib/hr/acknowledgements";
import { MEAL_WAIVER_KINDS, MEAL_WAIVER_LABELS, activeWaiver } from "@/lib/timeclock/meal-waiver";
import { getWaiverDocuments, getWaiverSignatures, mealWaiversLive } from "@/lib/timeclock/meal-waiver-server";
import { loadSelf, selfProblemMessage } from "../self";
import { RevokeWaiverButton, SignWaiverForm } from "./waiver-controls";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

export default async function MealWaiversPage() {
  const self = await loadSelf();
  if (!self.ok) return <section className={`${card} text-sm text-slate-600`}>{selfProblemMessage(self.reason)}</section>;

  const live = await mealWaiversLive();
  if (!live) {
    return (
      <section className={`${card} text-sm text-slate-600`}>
        Meal-period waivers will be offered here once HR publishes them.
      </section>
    );
  }
  if (!self.person.nonExempt) {
    return (
      <section className={`${card} text-sm text-slate-600`}>
        Meal-period waivers apply to non-exempt (hourly) staff. Your position is exempt, so there&apos;s nothing to
        sign here.
      </section>
    );
  }

  const [docs, signatures] = await Promise.all([getWaiverDocuments(), getWaiverSignatures(self.person.id)]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        California law gives you a 30-minute meal period before the end of your 5th hour of work, and a second one
        before the end of your 10th. On shorter days you may choose to waive them. Signing is always voluntary, and
        you can revoke a waiver here at any time.
      </p>
      {MEAL_WAIVER_KINDS.map((kind) => {
        const doc = docs[kind];
        const active = activeWaiver(signatures, kind);
        const history = signatures.filter((s) => s.kind === kind && s.revoked_at !== null);
        return (
          <section key={kind} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{MEAL_WAIVER_LABELS[kind]}</h2>
              {active ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                  Signed
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Not signed</span>
              )}
            </div>
            {active ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <span>
                  Signed {formatAckTimestamp(active.signed_at)} as “{active.signer_name}” (version {active.version_no}).
                </span>
                <RevokeWaiverButton kind={kind} />
              </div>
            ) : null}
            {doc ? (
              <details open={!active} className="rounded-lg border border-slate-200 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {doc.title} <span className="font-normal text-slate-400">· version {doc.versionNo}</span>
                </summary>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{doc.text}</div>
              </details>
            ) : (
              <p className="text-sm text-slate-500">This waiver isn&apos;t available right now.</p>
            )}
            {doc && !active ? <SignWaiverForm kind={kind} versionId={doc.versionId} title={doc.title} /> : null}
            {history.length > 0 ? (
              <p className="text-xs text-slate-400">
                Earlier:{" "}
                {history
                  .map((h) => `signed ${formatAckTimestamp(h.signed_at)}, revoked ${formatAckTimestamp(h.revoked_at)}`)
                  .join("; ")}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
