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
import { TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import { EmployeeSettingsRow } from "@/features/scheduling/setup/components/employee-settings-row";

/** `TableHead` styling, so the sortable `SortHeader` cells line up with the plain ones. */
const headCls = "h-10 px-2 text-left align-middle font-medium whitespace-nowrap";

/**
 * Sortable table of every employee's scheduling settings, one row per person.
 * The `<table>` is written out (not shadcn's `Table` wrapper) so this
 * scroll container is the one the sticky header pins to.
 */
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
      <table className="w-full caption-bottom text-sm">
        <TableHeader className={`${stickyHeadClass} text-xs uppercase text-muted-foreground`}>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Employee" sortKey="employee" sort={sort} className={headCls} />
            <SortHeader label="Schedule type" sortKey="scheduleType" sort={sort} className={headCls} />
            <SortHeader label="Weekly target" sortKey="weeklyTarget" sort={sort} className={headCls} />
            <SortHeader label="Preferred location" sortKey="preferred" sort={sort} className={headCls} />
            <TableHead className="text-muted-foreground">Eligible locations</TableHead>
            <TableHead className="text-muted-foreground">Available days</TableHead>
            <SortHeader label="Scheduling" sortKey="schedulable" sort={sort} className={headCls} />
          </TableRow>
        </TableHeader>
        <TableBody>
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
        </TableBody>
      </table>
    </div>
  );
}
