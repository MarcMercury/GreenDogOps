"use client";

import { useState } from "react";
import {
  ATTENDANCE_TONE,
  effectiveAttendance,
  gridName,
  type AttendanceStatus,
  type SchedAssignment,
  type SchedPerson,
  type WeekTimeOff,
} from "@/lib/schedule/types";
import { CollapsibleCellContent } from "@/features/scheduling/scheduling-grid/components/grid/collapsible-cell-content";
import { COL_W } from "@/features/scheduling/scheduling-grid/lib/grid-constants";

/** A single grid cell: the people on one shift line at one location on one day. */
export function GridCell({
  closed,
  accent,
  isDayStart,
  assignments,
  personById,
  weeklyCount,
  conflictReasons,
  weekTimeOff,
  isPublished,
  systemAttendance,
  canEdit,
  onAdd,
  onRemove,
  onMovePerson,
  onAttendance,
}: {
  closed: boolean;
  accent: string;
  isDayStart?: boolean;
  assignments: SchedAssignment[];
  personById: Map<string, SchedPerson>;
  weeklyCount: Map<string, number>;
  conflictReasons: Map<string, string[]>;
  weekTimeOff: WeekTimeOff;
  isPublished: boolean;
  systemAttendance: Record<string, AttendanceStatus>;
  canEdit: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMovePerson: (assignmentId: string) => void;
  onAttendance: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dayBorder = isDayStart
    ? "border-l-2 border-l-slate-300"
    : "border-l border-l-slate-200";
  if (closed) {
    return (
      <td
        className={`border-b border-b-slate-200 ${dayBorder} bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)] align-middle`}
        style={{ width: 18, minWidth: 18, maxWidth: 18 }}
        title="Location closed"
      />
    );
  }
  const visible = assignments.filter((a) => !a.removed_post_publish);
  const removed = assignments.filter((a) => a.removed_post_publish);

  // Drag-and-drop is gated on edit permission. The drop handler ignores rows
  // that already live in this cell so re-dropping in place is a clean no-op.
  const idsHere = new Set(visible.map((a) => a.id));

  return (
    <td
      className={`group border-b border-b-slate-200 ${dayBorder} align-top ${
        dragOver ? "outline outline-2 -outline-offset-2 outline-emerald-400" : ""
      }`}
      style={{
        width: COL_W,
        minWidth: COL_W,
        maxWidth: COL_W,
        backgroundColor: dragOver ? `${accent}33` : `${accent}14`,
        ...(isDayStart ? {} : { borderLeftColor: `${accent}55` }),
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!dragOver) setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const id = e.dataTransfer.getData("text/plain");
              if (id && !idsHere.has(id)) onMovePerson(id);
            }
          : undefined
      }
    >
      <CollapsibleCellContent>
      <div className="flex min-h-[40px] flex-col gap-0.5 p-1">
        {visible.map((a) => {
          const p = personById.get(a.person_id);
          const att = effectiveAttendance(a, isPublished, undefined, systemAttendance[a.id]);
          const marked = att !== "scheduled";
          const conflicts = conflictReasons.get(a.id);
          const hasConflict = !!conflicts?.length;
          const conflictTitle = hasConflict
            ? `Double-booked — also scheduled at: ${conflicts!.join("; ")}`
            : undefined;
          // Time-off clash: scheduled on a day this person has requested or
          // approved time off. Skip when the shift was already marked PTO —
          // that means the scheduler has already acknowledged it.
          const off = weekTimeOff.get(a.person_id)?.get(a.day_of_week);
          const hasTimeOff = !!off && att !== "pto";
          const timeOffTitle = hasTimeOff
            ? `Time off ${off === "approved" ? "approved" : "requested"} for this day`
            : undefined;
          // Edited while the week sits in "Pending Approval": light-blue cue so
          // the schedule maker can spot the approver's requested changes.
          const changedTitle = a.changed_after_approval
            ? "Changed since submitted for approval"
            : undefined;
          return (
            <div
              key={a.id}
              draggable={canEdit}
              onDragStart={
                canEdit
                  ? (e) => {
                      e.dataTransfer.setData("text/plain", a.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
                hasConflict
                  ? "bg-red-100 text-red-700 ring-1 ring-red-500"
                  : hasTimeOff
                    ? "bg-violet-100 text-violet-700 ring-1 ring-violet-500"
                    : a.changed_after_approval
                      ? "bg-sky-100 text-sky-800"
                      : marked
                        ? ATTENDANCE_TONE[att]
                        : "bg-slate-100 text-slate-700"
              } ${a.added_post_publish || a.changed_after_approval ? "ring-1 ring-sky-400" : ""} ${
                canEdit ? "cursor-grab active:cursor-grabbing" : ""
              }`}
              title={
                conflictTitle ??
                timeOffTitle ??
                changedTitle ??
                (canEdit
                  ? `${p ? gridName(p) : ""} — drag to move`
                  : p
                    ? gridName(p)
                    : "")
              }
            >
              {hasConflict ? (
                <span className="shrink-0 text-red-600" aria-hidden>
                  ⚠
                </span>
              ) : hasTimeOff ? (
                <span className="shrink-0 text-violet-600" aria-hidden>
                  🌴
                </span>
              ) : null}
              <button
                onClick={() => isPublished && onAttendance(a.id)}
                className={`flex-1 truncate text-left ${hasConflict || hasTimeOff ? "font-semibold" : ""} ${isPublished ? "cursor-pointer hover:underline" : ""}`}
                title={conflictTitle ?? timeOffTitle ?? (p ? gridName(p) : "")}
              >
                {p ? gridName(p) : "—"}
              </button>
              <span className="rounded-full bg-white/70 px-1 text-[9px] font-semibold text-slate-500">
                {weeklyCount.get(a.person_id) ?? 0}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                className="shrink-0 text-slate-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100 print:hidden"
                title="Remove"
              >
                ✕
              </button>
              <button
                onClick={onAdd}
                className="shrink-0 font-semibold text-slate-400 opacity-0 transition hover:text-emerald-600 group-hover:opacity-100 print:hidden"
                title="Add another person to this shift"
              >
                +
              </button>
            </div>
          );
        })}
        {removed.map((a) => {
          const p = personById.get(a.person_id);
          return (
            <div
              key={a.id}
              className="flex items-center gap-1 rounded bg-red-50 px-1 py-0.5 text-[11px] text-red-400 line-through"
              title="Removed after publish — counted as absent"
            >
              <span className="flex-1 truncate">{p ? gridName(p) : "—"}</span>
              <span className="text-[9px] font-semibold uppercase">abs</span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <button
            onClick={onAdd}
            className="flex-1 rounded border border-dashed border-slate-200 text-[10px] text-slate-300 opacity-0 transition hover:border-emerald-300 hover:text-emerald-500 group-hover:opacity-100 print:hidden"
            title="Add a person to this shift"
          >
            + add
          </button>
        )}
      </div>
      </CollapsibleCellContent>
    </td>
  );
}
