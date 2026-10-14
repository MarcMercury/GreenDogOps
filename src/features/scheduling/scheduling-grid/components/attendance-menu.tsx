"use client";

import { useState } from "react";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  MARKABLE_ATTENDANCE,
  effectiveAttendance,
  gridName,
  type AttendanceStatus,
  type SchedAssignment,
  type SchedPerson,
} from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Attendance marking menu for one published shift. */
export function AttendanceMenu({
  assignment,
  systemStatus,
  person,
  onClose,
  onMark,
}: {
  assignment: SchedAssignment;
  /** Time-clock grade when attendance is live and the shift is unmarked. */
  systemStatus?: AttendanceStatus;
  person: SchedPerson | undefined;
  onClose: () => void;
  onMark: (status: AttendanceStatus, note: string | null) => void | Promise<unknown>;
}) {
  const [note, setNote] = useState(assignment.attendance_note ?? "");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{person ? gridName(person) : "Attendance"}</DialogTitle>
          <DialogDescription>
            Current:{" "}
            <span className="font-medium text-foreground">
              {ATTENDANCE_LABELS[effectiveAttendance(assignment, true, undefined, systemStatus)]}
            </span>
            {systemStatus && assignment.attendance_status === "scheduled" ? (
              <span> · from the time clock</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* The statuses keep their attendance colours — the chips are the legend. */}
          <div className="grid grid-cols-2 gap-2">
            {MARKABLE_ATTENDANCE.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void onMark(s, note.trim() || null)}
                className={`rounded-lg px-2 py-2 text-xs font-semibold ${ATTENDANCE_TONE[s]} ring-1 ring-inset ring-black/5 transition hover:opacity-80`}
              >
                {ATTENDANCE_LABELS[s]}
              </button>
            ))}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void onMark("scheduled", note.trim() || null)}
          >
            Clear marking (assume Present)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
