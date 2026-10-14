"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceStatus, ScheduleStatus } from "@/lib/schedule/types";
import { useAction } from "@/features/scheduling/shared/hooks/use-action";
import { toastResult, toastThrown } from "@/features/scheduling/shared/lib/action-toast";
import {
  assignPerson,
  moveAssignment,
  removeAssignment,
} from "@/features/scheduling/scheduling-grid/actions/assignment-actions";
import { markAttendance } from "@/features/scheduling/scheduling-grid/actions/attendance-actions";
import { toggleClosure } from "@/features/scheduling/scheduling-grid/actions/closure-actions";
import { setEvent } from "@/features/scheduling/scheduling-grid/actions/event-actions";
import { setTimeOffStatus } from "@/features/scheduling/scheduling-grid/actions/time-off-actions";
import {
  applyDefaultTemplate,
  removeWeekLine,
} from "@/features/scheduling/scheduling-grid/actions/week-line-actions";
import { setWeekStatus } from "@/features/scheduling/scheduling-grid/actions/week-status-actions";
import { WEEK_STATUS_SUCCESS } from "@/features/scheduling/scheduling-grid/lib/week-status-messages";
import type { CellKey } from "@/features/scheduling/scheduling-grid/types/grid";

/**
 * The grid's Server Actions, each wrapped so a click gets a transition, a
 * success / error toast and a data refresh. Publishing is the one exception:
 * a week with untimed shifts comes back as a question ("Publish anyway?"),
 * which the grid answers with a dialog, not a toast.
 */
export function useGridActions(weekId: string) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [statusPending, startStatus] = useTransition();

  return {
    pending: pending || statusPending,
    assign: (cell: CellKey, personId: string) =>
      run(() => assignPerson(weekId, cell.lineId, cell.locationId, cell.day, personId), "Shift assigned"),
    remove: (assignmentId: string) => run(() => removeAssignment(assignmentId), "Shift removed"),
    move: (assignmentId: string, lineId: string, locationId: string, day: number) =>
      run(() => moveAssignment(assignmentId, lineId, locationId, day), "Shift moved"),
    mark: (assignmentId: string, status: AttendanceStatus, note: string | null) =>
      run(() => markAttendance(assignmentId, status, note), "Attendance saved"),
    closure: (locationId: string, day: number) =>
      run(() => toggleClosure(weekId, locationId, day), "Location updated"),
    event: (locationId: string, day: number, title: string) =>
      run(() => setEvent(weekId, locationId, day, title), title.trim() ? "Event saved" : "Event cleared"),
    timeOff: (requestId: string, status: "approved" | "denied") =>
      run(
        () => setTimeOffStatus(requestId, status),
        status === "approved" ? "Time off approved" : "Time off denied",
      ),
    removeLine: (lineId: string) => run(() => removeWeekLine(lineId), "Shift line deleted"),
    loadDefaultTemplate: () => run(() => applyDefaultTemplate(weekId), "Dept/Shift Template loaded"),
    /**
     * Move the week through the workflow. When publishing stops on shifts
     * without times, `onUntimed` gets the list so the grid can ask first.
     */
    setStatus: (status: ScheduleStatus, onUntimed: (untimed: string[], error: string) => void) =>
      startStatus(async () => {
        try {
          const res = await setWeekStatus(weekId, status);
          if (!res.ok && "untimed" in res) {
            onUntimed(res.untimed, res.error);
            return;
          }
          toastResult(res, WEEK_STATUS_SUCCESS[status]);
          if (res.ok) router.refresh();
        } catch (error) {
          toastThrown(error);
        }
      }),
    /** The "Publish anyway?" answer: the same transition with the override. */
    setStatusConfirmed: (status: ScheduleStatus) =>
      run(() => setWeekStatus(weekId, status, { confirmUntimed: true }), WEEK_STATUS_SUCCESS[status]),
  };
}

export type GridActionRunners = ReturnType<typeof useGridActions>;
