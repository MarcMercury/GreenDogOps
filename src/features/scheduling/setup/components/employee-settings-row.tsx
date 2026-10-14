"use client";

import Link from "next/link";
import {
  DAY_SHORT,
  gridName,
  type ScheduleLocation,
  type SchedEmployeeSetting,
  type SchedPerson,
} from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableRow } from "@/components/ui/table";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import { effectiveEligibleLocationIds } from "@/features/scheduling/setup/lib/default-eligible-locations";

/**
 * One employee's scheduling settings: weekly target, preferred location,
 * eligible-location and available-day chips, and the Scheduling Active switch.
 * Each control saves on its own (blur / change / click) and toasts.
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
    <TableRow className={pending ? "opacity-70" : undefined}>
      <TableCell className="font-medium">
        <Link
          href={`/hr/${p.id}`}
          className="hover:text-primary hover:underline"
          title="Open HR profile"
        >
          {gridName(p)}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground" title="Schedule type — set in HR / Roster">
        {p.schedule_type ?? "—"}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          max={7}
          defaultValue={s?.weekly_shift_target ?? 5}
          aria-label={`Weekly target for ${gridName(p)}`}
          onBlur={(e) => onUpdate(p.id, { target: Number(e.target.value) })}
          className="w-16"
        />
      </TableCell>
      <TableCell>
        <NativeSelect
          size="sm"
          value={p.preferred_location_id ?? ""}
          onChange={(e) => onUpdatePreferred(p.id, e.target.value || null)}
          aria-label={`Preferred location for ${gridName(p)}`}
          title="Employee's preferred work location"
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          {locations.map((l) => (
            <NativeSelectOption key={l.id} value={l.id}>
              {l.short_code || l.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {locations.map((l) => {
            const on = eligible.includes(l.id);
            return (
              <Button
                key={l.id}
                type="button"
                variant={on ? "default" : "outline"}
                size="xs"
                className="rounded-full"
                onClick={() => {
                  const next = on
                    ? eligible.filter((x) => x !== l.id)
                    : [...eligible, l.id];
                  onUpdate(p.id, { eligibleLocs: next });
                }}
                title={on ? `Eligible at ${l.name}` : `Not eligible at ${l.name}`}
              >
                {l.short_code || l.name}
              </Button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          None = any location
        </p>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {DAY_SHORT.map((label, day) => {
            const on = (s?.available_days ?? []).includes(day);
            return (
              <Button
                key={day}
                type="button"
                variant={on ? "default" : "outline"}
                size="xs"
                className="rounded-full"
                onClick={() => {
                  const cur = s?.available_days ?? [];
                  const next = on
                    ? cur.filter((x) => x !== day)
                    : [...cur, day];
                  onUpdate(p.id, { days: next });
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          None = any day
        </p>
      </TableCell>
      <TableCell>
        <Switch
          defaultChecked={s?.is_schedulable ?? false}
          aria-label={`Scheduling Active for ${gridName(p)}`}
          title="Scheduling Active — also editable on the HR / Roster record"
          onCheckedChange={(checked) =>
            onUpdate(
              p.id,
              checked
                ? { schedulable: true }
                : { schedulable: false, eligibleLocs: [] },
            )
          }
        />
      </TableCell>
    </TableRow>
  );
}
