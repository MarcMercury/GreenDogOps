"use client";

import {
  APPT_REPORT_TRACK_LABELS,
  APPT_REPORT_TRACKS,
  type ApptTypeDeptMapping,
  type SchedDepartment,
} from "@/lib/schedule/types";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  IGNORE_VALUE,
  apptTypeSelectValue,
} from "@/features/scheduling/setup/lib/appt-type-select";

/** One appointment type: its booking count, department pick and Slack report lane. */
export function ApptTypeRow({
  mapping: m,
  dept,
  departments,
  disabled,
  onChangeDept,
  onChangeTrack,
}: {
  mapping: ApptTypeDeptMapping;
  /** The department currently assigned, for the colour swatch. */
  dept: SchedDepartment | null | undefined;
  departments: SchedDepartment[];
  disabled: boolean;
  onChangeDept: (value: string) => void;
  onChangeTrack: (value: string) => void;
}) {
  const value = apptTypeSelectValue(m);
  const unassigned = !m.department_id && !m.is_ignored;
  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          {dept ? (
            <span
              className="h-3 w-3 shrink-0 rounded"
              style={{ background: dept.color }}
            />
          ) : (
            <span className="h-3 w-3 shrink-0 rounded border border-dashed border-border" />
          )}
          <span className="font-medium">{m.appt_type}</span>
        </span>
      </TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">
        {m.observed_count > 0 ? m.observed_count : "—"}
      </TableCell>
      <TableCell>
        <NativeSelect
          size="sm"
          value={value}
          disabled={disabled}
          onChange={(e) => onChangeDept(e.target.value)}
          aria-label={`Department for ${m.appt_type}`}
          className={`min-w-[200px] ${unassigned ? "[&_select]:border-amber-300 [&_select]:bg-amber-50" : ""}`}
        >
          <NativeSelectOption value="">— Unassigned —</NativeSelectOption>
          {departments.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {d.name}
              {d.show_in_planning ? "" : " (non-planning)"}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={IGNORE_VALUE}>Ignore (don&apos;t count)</NativeSelectOption>
        </NativeSelect>
      </TableCell>
      <TableCell>
        <NativeSelect
          size="sm"
          value={m.report_track ?? ""}
          disabled={disabled}
          onChange={(e) => onChangeTrack(e.target.value)}
          aria-label={`Slack report lane for ${m.appt_type}`}
          className="min-w-[150px]"
        >
          <NativeSelectOption value="">— Not reported —</NativeSelectOption>
          {APPT_REPORT_TRACKS.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {APPT_REPORT_TRACK_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </TableCell>
    </TableRow>
  );
}
