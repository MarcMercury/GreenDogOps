import type { CorrectionItem } from "@/lib/timeclock/review";
import { PUNCH_LABELS } from "@/lib/timeclock/state";
import { shortDateLabel } from "@/lib/worklist/dates";
import { CorrectionDecision } from "@/features/scheduling/time-clock/components/correction-decision";
import { QueueSection } from "@/features/scheduling/time-clock/components/queue-section";
import { KIND_LABEL } from "@/features/scheduling/time-clock/lib/constants";
import { correctionTargets } from "@/features/scheduling/time-clock/lib/correction-targets";
import { clockTime } from "@/features/scheduling/time-clock/server/clock-time";

/** Employees' correction requests waiting for a decision, with that day's punches for context. */
export function CorrectionQueue({ items, approver }: { items: CorrectionItem[]; approver: boolean }) {
  return (
    <QueueSection title="Correction requests" count={items.length} hint="From employees">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((c) => {
            const targets = correctionTargets(c, clockTime);
            return (
              <li key={c.id} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
                <div className="text-sm">
                  <p className="font-medium text-slate-900">
                    {c.person_name} · {shortDateLabel(c.work_date)} · {KIND_LABEL[c.kind]}
                    {c.punch_type ? ` · ${PUNCH_LABELS[c.punch_type]}` : ""}
                    {c.requested_time ? ` → ${clockTime(c.requested_time)}` : ""}
                  </p>
                  <p className="text-slate-600">“{c.reason}”</p>
                  <p className="text-xs text-slate-400">
                    That day:{" "}
                    {c.day_punches.length === 0
                      ? "no punches"
                      : c.day_punches.map((p) => `${PUNCH_LABELS[p.punch_type]} ${clockTime(p.punched_at)}`).join(" · ")}
                  </p>
                  {c.kind === "other" ? (
                    <p className="text-xs text-slate-400">Approving records the decision only; add any punch below if needed.</p>
                  ) : null}
                </div>
                {approver ? (
                  <CorrectionDecision requestId={c.id} needsTarget={c.kind === "wrong_time"} targets={targets} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </QueueSection>
  );
}
