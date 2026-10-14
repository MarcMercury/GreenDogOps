"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApptTypeDeptMapping } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  saveApptTypeDept,
  saveApptTypeReportTrack,
} from "@/features/scheduling/setup/actions/appt-type-actions";
import { IGNORE_VALUE } from "@/features/scheduling/setup/lib/appt-type-select";
import { inputCls } from "@/features/scheduling/setup/lib/ui-classes";
import { Card } from "@/features/scheduling/setup/components/card";
import { ApptTypeRow } from "@/features/scheduling/setup/components/appt-type-row";

// ===========================================================================
// Planning Guide Setup — appointment type → department
// ===========================================================================

export function PlanningGuideTab({
  data,
  mappings,
}: {
  data: SetupData;
  mappings: ApptTypeDeptMapping[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Departments the appointment types can be assigned to (active only), with
  // the planning departments floated to the top since those are the usual picks.
  const departments = useMemo(
    () =>
      data.departments
        .filter((d) => d.is_active)
        .sort(
          (a, b) =>
            Number(b.show_in_planning) - Number(a.show_in_planning) ||
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name),
        ),
    [data.departments],
  );
  const deptById = useMemo(
    () => new Map(data.departments.map((d) => [d.id, d])),
    [data.departments],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((m) => {
      const dept = m.department_id ? deptById.get(m.department_id)?.name ?? "" : "";
      return (
        m.appt_type.toLowerCase().includes(q) || dept.toLowerCase().includes(q)
      );
    });
  }, [mappings, query, deptById]);

  const unassignedCount = useMemo(
    () => mappings.filter((m) => !m.department_id && !m.is_ignored).length,
    [mappings],
  );

  function save(apptType: string, value: string) {
    setError(null);
    setSavingType(apptType);
    const fd = new FormData();
    fd.set("appt_type", apptType);
    if (value === IGNORE_VALUE) fd.set("is_ignored", "on");
    else if (value) fd.set("department_id", value);
    start(async () => {
      const res = await saveApptTypeDept(fd);
      setSavingType(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function saveTrack(apptType: string, value: string) {
    setError(null);
    setSavingType(apptType);
    const fd = new FormData();
    fd.set("appt_type", apptType);
    if (value) fd.set("report_track", value);
    start(async () => {
      const res = await saveApptTypeReportTrack(fd);
      setSavingType(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-slate-700">
              Appointment type → department
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Tell the schedule which department renders each ezyVet appointment
              type. This attributes booked-appointment demand to the right team on
              the Grid, Daily Capacity, and Planning Guides — e.g. both{" "}
              <span className="font-medium text-slate-600">GDD (New)</span> and{" "}
              <span className="font-medium text-slate-600">GDD (Returning)</span>{" "}
              are done by the{" "}
              <span className="font-medium text-slate-600">NAD/VE/UC</span>{" "}
              department. Types left unassigned fall back to the ezyVet resource
              calendar they were booked on.
            </p>
          </div>
          <input
            type="search"
            placeholder="Filter types…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputCls}
          />
        </div>

        {unassignedCount > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            {unassignedCount} appointment type{unassignedCount === 1 ? "" : "s"}{" "}
            still unassigned — assign a department so they count toward the right
            team.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-medium">Appointment type</th>
                <th className="py-2 pr-3 font-medium">Booked</th>
                <th className="py-2 pr-3 font-medium">Department</th>
                <th className="py-2 font-medium">Slack report lane</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((m) => (
                <ApptTypeRow
                  key={m.appt_type}
                  mapping={m}
                  dept={m.department_id ? deptById.get(m.department_id) : null}
                  departments={departments}
                  disabled={pending && savingType === m.appt_type}
                  onChangeDept={(value) => save(m.appt_type, value)}
                  onChangeTrack={(value) => saveTrack(m.appt_type, value)}
                />
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                    No appointment types match “{query}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
