"use client";

import { useMemo, useState } from "react";
import type { ApptTypeDeptMapping } from "@/lib/schedule/types";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import {
  saveApptTypeDept,
  saveApptTypeReportTrack,
} from "@/features/scheduling/setup/actions/appt-type-actions";
import { apptTypeDeptInput } from "@/features/scheduling/setup/lib/appt-type-select";
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
  const { run } = useAction();
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

  async function save(apptType: string, value: string) {
    setSavingType(apptType);
    await run(() => saveApptTypeDept(apptTypeDeptInput(apptType, value)), "Department saved");
    setSavingType(null);
  }

  async function saveTrack(apptType: string, value: string) {
    setSavingType(apptType);
    await run(
      () => saveApptTypeReportTrack({ appt_type: apptType, report_track: value }),
      "Report lane saved",
    );
    setSavingType(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appointment type → department</CardTitle>
        <CardDescription className="max-w-2xl">
          Tell the schedule which department renders each ezyVet appointment
          type. This attributes booked-appointment demand to the right team on
          the Grid, Daily Capacity, and Planning Guides — e.g. both{" "}
          <span className="font-medium text-foreground">GDD (New)</span> and{" "}
          <span className="font-medium text-foreground">GDD (Returning)</span>{" "}
          are done by the{" "}
          <span className="font-medium text-foreground">NAD/VE/UC</span>{" "}
          department. Types left unassigned fall back to the ezyVet resource
          calendar they were booked on.
        </CardDescription>
        <CardAction>
          <Input
            type="search"
            placeholder="Filter types…"
            aria-label="Filter appointment types"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-56"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {unassignedCount > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            {unassignedCount} appointment type{unassignedCount === 1 ? "" : "s"}{" "}
            still unassigned — assign a department so they count toward the right
            team.
          </p>
        ) : null}

        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead>Appointment type</TableHead>
              <TableHead>Booked</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Slack report lane</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <ApptTypeRow
                key={m.appt_type}
                mapping={m}
                dept={m.department_id ? deptById.get(m.department_id) : null}
                departments={departments}
                disabled={savingType === m.appt_type}
                onChangeDept={(value) => void save(m.appt_type, value)}
                onChangeTrack={(value) => void saveTrack(m.appt_type, value)}
              />
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  No appointment types match “{query}”.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
