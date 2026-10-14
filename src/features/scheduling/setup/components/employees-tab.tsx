"use client";

import { useMemo, useState } from "react";
import { gridName } from "@/lib/schedule/types";
import { useTableSort } from "@/app/(app)/_components/data-views";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import {
  saveEmployeeSetting,
  savePreferredLocation,
} from "@/features/scheduling/setup/actions/employee-setting-actions";
import { defaultEligibleLocationIds } from "@/features/scheduling/setup/lib/default-eligible-locations";
import { EmployeeSettingsTable } from "@/features/scheduling/setup/components/employee-settings-table";

// ===========================================================================
// Employees
// ===========================================================================

export function EmployeesTab({ data }: { data: SetupData }) {
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [hideNonSchedulable, setHideNonSchedulable] = useState(false);

  const settingByPerson = useMemo(() => {
    const m = new Map(data.settings.map((s) => [s.person_id, s]));
    return m;
  }, [data.settings]);

  // Default eligibility for employees with no explicit selection: every
  // location except MPMV (i.e. SO, VEN, VAN). Mirrors the schedule grid which
  // also excludes MPMV.
  const defaultEligibleLocIds = useMemo(
    () => defaultEligibleLocationIds(data.locations),
    [data.locations],
  );

  const people = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.people
      .filter((p) => !term || gridName(p).toLowerCase().includes(term))
      .filter(
        (p) =>
          !hideNonSchedulable ||
          (settingByPerson.get(p.id)?.is_schedulable ?? false),
      )
      .sort((a, b) => gridName(a).localeCompare(gridName(b)));
  }, [data.people, q, hideNonSchedulable, settingByPerson]);

  const locName = (id: string | null | undefined) => {
    if (!id) return null;
    const l = data.locations.find((x) => x.id === id);
    return l ? l.short_code || l.name : null;
  };
  const peopleSort = useTableSort(people, {
    employee: (p) => gridName(p),
    scheduleType: (p) => p.schedule_type,
    weeklyTarget: (p) => settingByPerson.get(p.id)?.weekly_shift_target ?? 5,
    preferred: (p) => locName(p.preferred_location_id),
    schedulable: (p) => ((settingByPerson.get(p.id)?.is_schedulable ?? false) ? 1 : 0),
  });

  function update(personId: string, patch: EmployeeSettingUpdate) {
    const cur = settingByPerson.get(personId);
    const target = patch.target ?? cur?.weekly_shift_target ?? 5;
    const schedulable = patch.schedulable ?? cur?.is_schedulable ?? false;
    const loc =
      patch.loc !== undefined ? patch.loc : cur?.default_location_id ?? null;
    const eligibleLocs =
      patch.eligibleLocs ?? cur?.eligible_location_ids ?? [];
    const days = patch.days ?? cur?.available_days ?? [];
    void run(
      () => saveEmployeeSetting(personId, target, schedulable, loc, eligibleLocs, days),
      "Settings saved",
    );
  }

  function updatePreferred(personId: string, locationId: string | null) {
    void run(() => savePreferredLocation(personId, locationId), "Preferred location saved");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee scheduling settings</CardTitle>
        <CardAction className="flex items-center gap-3">
          <Label className="cursor-pointer text-xs font-medium">
            <Checkbox
              checked={hideNonSchedulable}
              onCheckedChange={(checked) => setHideNonSchedulable(checked)}
            />
            Hide scheduling-inactive
          </Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search employees"
            className="w-48"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <EmployeeSettingsTable
          sort={peopleSort}
          locations={data.locations}
          settingByPerson={settingByPerson}
          defaultEligibleLocIds={defaultEligibleLocIds}
          pending={pending}
          onUpdate={update}
          onUpdatePreferred={updatePreferred}
        />
      </CardContent>
    </Card>
  );
}
