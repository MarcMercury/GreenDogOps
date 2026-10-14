import { OFFSITE_LOOKBACK_DAYS, type OffsiteItem } from "@/lib/timeclock/review";
import { PUNCH_LABELS } from "@/lib/timeclock/state";
import { shortDateLabel } from "@/lib/worklist/dates";
import { OffsiteDecision } from "@/features/scheduling/time-clock/components/offsite-decision";
import { QueueSection } from "@/features/scheduling/time-clock/components/queue-section";
import { clockTime } from "@/features/scheduling/time-clock/server/clock-time";

/**
 * Off-site punches waiting for a decision. The location evidence (IP, GPS,
 * browser) is shown to approvers only; Schedule Admins see the punch and the
 * employee's note but cannot decide.
 */
export function OffsiteQueue({
  items,
  approver,
  locationNames,
}: {
  items: OffsiteItem[];
  approver: boolean;
  locationNames: Map<string, string>;
}) {
  return (
    <QueueSection title="Off-site punches" count={items.length} hint={`Last ${OFFSITE_LOOKBACK_DAYS} days`}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((o) => (
            <li key={o.punch_id} className="grid gap-3 py-3 md:grid-cols-[1fr_18rem]">
              <div className="text-sm">
                <p className="font-medium text-slate-900">
                  {o.person_name} · {PUNCH_LABELS[o.punch_type]} {shortDateLabel(o.work_date)} at {clockTime(o.punched_at)}
                </p>
                <p className="text-slate-600">“{o.note}”</p>
                <p className="text-xs text-slate-400">
                  {o.location_id ? `Scheduled at ${locationNames.get(o.location_id) ?? "—"}` : "Unscheduled"}
                  {o.distance_m != null ? ` · ${(o.distance_m / 1000).toFixed(1)} km from the clinic` : ""}
                </p>
                {approver ? (
                  <p className="text-xs text-slate-400">
                    IP {o.ip ?? "unknown"}
                    {o.latitude != null && o.longitude != null
                      ? ` · GPS ${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)} (±${Math.round(o.accuracy_m ?? 0)} m)`
                      : " · no GPS"}
                    {o.user_agent ? ` · ${o.user_agent.slice(0, 80)}` : ""}
                  </p>
                ) : null}
              </div>
              {approver ? <OffsiteDecision punchId={o.punch_id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </QueueSection>
  );
}
