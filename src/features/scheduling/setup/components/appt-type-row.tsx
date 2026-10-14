"use client";

import {
  APPT_REPORT_TRACK_LABELS,
  APPT_REPORT_TRACKS,
  type ApptTypeDeptMapping,
  type SchedDepartment,
} from "@/lib/schedule/types";
import {
  IGNORE_VALUE,
  apptTypeSelectValue,
} from "@/features/scheduling/setup/lib/appt-type-select";
import { inputCls } from "@/features/scheduling/setup/lib/ui-classes";

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
  return (
    <tr className="align-middle">
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2">
          {dept ? (
            <span
              className="h-3 w-3 shrink-0 rounded"
              style={{ background: dept.color }}
            />
          ) : (
            <span className="h-3 w-3 shrink-0 rounded border border-dashed border-slate-300" />
          )}
          <span className="font-medium text-slate-800">
            {m.appt_type}
          </span>
        </span>
      </td>
      <td className="py-2 pr-3 text-xs tabular-nums text-slate-400">
        {m.observed_count > 0 ? m.observed_count : "—"}
      </td>
      <td className="py-2">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChangeDept(e.target.value)}
          className={`${inputCls} min-w-[200px] disabled:opacity-50 ${
            !m.department_id && !m.is_ignored
              ? "border-amber-300 bg-amber-50"
              : ""
          }`}
        >
          <option value="">— Unassigned —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.show_in_planning ? "" : " (non-planning)"}
            </option>
          ))}
          <option value={IGNORE_VALUE}>Ignore (don&apos;t count)</option>
        </select>
      </td>
      <td className="py-2">
        <select
          value={m.report_track ?? ""}
          disabled={disabled}
          onChange={(e) => onChangeTrack(e.target.value)}
          className={`${inputCls} min-w-[150px] disabled:opacity-50`}
        >
          <option value="">— Not reported —</option>
          {APPT_REPORT_TRACKS.map((t) => (
            <option key={t} value={t}>
              {APPT_REPORT_TRACK_LABELS[t]}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
