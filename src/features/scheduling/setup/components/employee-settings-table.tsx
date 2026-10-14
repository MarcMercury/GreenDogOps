"use client";

import type {
  ScheduleLocation,
  SchedEmployeeSetting,
  SchedPerson,
} from "@/lib/schedule/types";
import {
  SortHeader,
  stickyHeadClass,
  type TableSort,
} from "@/app/(app)/_components/data-views";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import { EmployeeSettingsRow } from "@/features/scheduling/setup/components/employee-settings-row";

/** Sortable table of every employee's scheduling settings, one row per person. */
export function EmployeeSettingsTable({
  sort,
  locations,
  settingByPerson,
  defaultEligibleLocIds,
  pending,
  onUpdate,
  onUpdatePreferred,
}: {
  sort: TableSort<SchedPerson>;
  locations: ScheduleLocation[];
  settingByPerson: Map<string, SchedEmployeeSetting>;
  defaultEligibleLocIds: string[];
  pending: boolean;
  onUpdate: (personId: string, patch: EmployeeSettingUpdate) => void;
  onUpdatePreferred: (personId: string, locationId: string | null) => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className={`${stickyHeadClass} text-left text-xs uppercase text-slate-400`}>
          <tr className="border-b border-slate-200">
            <SortHeader label="Employee" sortKey="employee" sort={sort} className="py-2 pr-4 font-medium" />
            <SortHeader label="Schedule type" sortKey="scheduleType" sort={sort} className="py-2 pr-4 font-medium" />
            <SortHeader label="Weekly target" sortKey="weeklyTarget" sort={sort} className="py-2 pr-4 font-medium" />
            <SortHeader label="Preferred location" sortKey="preferred" sort={sort} className="py-2 pr-4 font-medium" />
            <th className="py-2 pr-4 font-medium">Eligible locations</th>
            <th className="py-2 pr-4 font-medium">Available days</th>
            <SortHeader label="Scheduling" sortKey="schedulable" sort={sort} className="py-2 pr-4 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {sort.sorted.map((p) => (
            <EmployeeSettingsRow
              key={p.id}
              person={p}
              setting={settingByPerson.get(p.id)}
              locations={locations}
              defaultEligibleLocIds={defaultEligibleLocIds}
              pending={pending}
              onUpdate={onUpdate}
              onUpdatePreferred={onUpdatePreferred}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
