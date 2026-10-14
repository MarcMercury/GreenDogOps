import { MISSING_PUNCH_LOOKBACK_DAYS, type MissingItem } from "@/lib/timeclock/review";
import { PUNCH_LABELS } from "@/lib/timeclock/state";
import { shortDateLabel } from "@/lib/worklist/dates";
import { AddPunchForm } from "@/features/scheduling/time-clock/components/add-punch-form";
import { QueueSection } from "@/features/scheduling/time-clock/components/queue-section";
import { clockTime } from "@/features/scheduling/time-clock/server/clock-time";

/** Sessions with no clock-out (or no clock-in); approvers can add the missing punch. */
export function MissingPunchQueue({ items, approver }: { items: MissingItem[]; approver: boolean }) {
  return (
    <QueueSection title="Missing punches" count={items.length} hint={`Last ${MISSING_PUNCH_LOOKBACK_DAYS} days`}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Every shift has a clock-in and clock-out.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((m) => (
            <li key={`${m.person_id}|${m.work_date}|${m.first_punch_at}`} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
              <div className="text-sm">
                <p className="font-medium text-slate-900">
                  {m.person_name} · {shortDateLabel(m.work_date)} ·{" "}
                  {m.status === "missing_clock_out" ? "No clock-out" : "No clock-in"}
                </p>
                <p className="text-xs text-slate-400">
                  First punch: {PUNCH_LABELS[m.first_punch_type]} at {clockTime(m.first_punch_at)}
                  {m.has_request ? " · the employee has asked for a correction (above)" : ""}
                </p>
              </div>
              {approver ? (
                <AddPunchForm
                  personId={m.person_id}
                  workDate={m.work_date}
                  defaultType={m.status === "missing_clock_out" ? "clock_out" : "clock_in"}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </QueueSection>
  );
}
