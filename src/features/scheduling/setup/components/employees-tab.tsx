"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gridName } from "@/lib/schedule/types";
import { useTableSort } from "@/app/(app)/_components/data-views";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import type { EmployeeSettingUpdate } from "@/features/scheduling/setup/types/employee-setting-update";
import {
  saveEmployeeSetting,
  savePreferredLocation,
} from "@/features/scheduling/setup/actions/employee-setting-actions";
import { defaultEligibleLocationIds } from "@/features/scheduling/setup/lib/default-eligible-locations";
import { inputCls } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";
import { EmployeeSettingsTable } from "@/features/scheduling/setup/components/employee-settings-table";

// ===========================================================================
// Employees
// ===========================================================================

export function EmployeesTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
    start(async () => {
      await saveEmployeeSetting(
        personId,
        target,
        schedulable,
        loc,
        eligibleLocs,
        days,
      );
      router.refresh();
    });
  }

  function updatePreferred(personId: string, locationId: string | null) {
    start(async () => {
      await savePreferredLocation(personId, locationId);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Employee scheduling settings
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={hideNonSchedulable}
              onChange={(e) => setHideNonSchedulable(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Hide scheduling-inactive
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className={inputCls}
          />
        </div>
      </div>
      <EmployeeSettingsTable
        sort={peopleSort}
        locations={data.locations}
        settingByPerson={settingByPerson}
        defaultEligibleLocIds={defaultEligibleLocIds}
        pending={pending}
        onUpdate={update}
        onUpdatePreferred={updatePreferred}
      />
    </Card>
  );
}
