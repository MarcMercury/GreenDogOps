"use client";

import Link from "next/link";
import {
  DAY_SHORT,
  gridName,
  type ScheduleLocation,
  type SchedEmployeeSetting,
  type SchedPerson,
} from "@/lib/schedule/types";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import { effectiveEligibleLocationIds } from "@/features/scheduling/setup/lib/default-eligible-locations";
import { inputCls } from "@/features/scheduling/setup/lib/ui-classes";

/**
 * One employee's scheduling settings: weekly target, preferred location,
 * eligible-location and available-day chips, and the Scheduling Active box.
 */
export function EmployeeSettingsRow({
  person: p,
  setting: s,
  locations,
  defaultEligibleLocIds,
  pending,
  onUpdate,
  onUpdatePreferred,
}: {
  person: SchedPerson;
  setting: SchedEmployeeSetting | undefined;
  locations: ScheduleLocation[];
  defaultEligibleLocIds: string[];
  pending: boolean;
  onUpdate: (personId: string, patch: EmployeeSettingUpdate) => void;
  onUpdatePreferred: (personId: string, locationId: string | null) => void;
}) {
  const eligible = effectiveEligibleLocationIds(s, defaultEligibleLocIds);
  return (
    <tr className={pending ? "opacity-70" : ""}>
      <td className="py-2 pr-4 font-medium text-slate-800">
        <Link
          href={`/hr/${p.id}`}
          className="text-slate-800 hover:text-emerald-700 hover:underline"
          title="Open HR profile"
        >
          {gridName(p)}
        </Link>
      </td>
      <td
        className="py-2 pr-4 text-slate-600"
        title="Schedule type — set in HR / Roster"
      >
        {p.schedule_type ?? "—"}
      </td>
      <td className="py-2 pr-4">
        <input
          type="number"
          min={0}
          max={7}
          defaultValue={s?.weekly_shift_target ?? 5}
          onBlur={(e) =>
            onUpdate(p.id, { target: Number(e.target.value) })
          }
          className={`w-16 ${inputCls}`}
        />
      </td>
      <td className="py-2 pr-4">
        <select
          value={p.preferred_location_id ?? ""}
          onChange={(e) =>
            onUpdatePreferred(p.id, e.target.value || null)
          }
          className={inputCls}
          title="Employee's preferred work location"
        >
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.short_code || l.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap gap-1">
          {locations.map((l) => {
            const on = eligible.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  const next = on
                    ? eligible.filter((x) => x !== l.id)
                    : [...eligible, l.id];
                  onUpdate(p.id, { eligibleLocs: next });
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  on
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                title={
                  on
                    ? `Eligible at ${l.name}`
                    : `Not eligible at ${l.name}`
                }
              >
                {l.short_code || l.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          None = any location
        </p>
      </td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap gap-1">
          {DAY_SHORT.map((label, day) => {
            const on = (s?.available_days ?? []).includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  const cur = s?.available_days ?? [];
                  const next = on
                    ? cur.filter((x) => x !== day)
                    : [...cur, day];
                  onUpdate(p.id, { days: next });
                }}
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium transition ${
                  on
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          None = any day
        </p>
      </td>
      <td className="py-2 pr-4">
        <input
          type="checkbox"
          defaultChecked={s?.is_schedulable ?? false}
          title="Scheduling Active — also editable on the HR / Roster record"
          onChange={(e) =>
            onUpdate(
              p.id,
              e.target.checked
                ? { schedulable: true }
                : { schedulable: false, eligibleLocs: [] },
            )
          }
        />
      </td>
    </tr>
  );
}
