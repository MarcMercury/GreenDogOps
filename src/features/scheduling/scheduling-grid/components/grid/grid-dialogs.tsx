"use client";

import type { SchedAssignment, SchedWeekLine, ScheduleLocation } from "@/lib/schedule/types";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { ConfirmDialog } from "@/features/scheduling/shared/components/confirm-dialog";
import { AttendanceMenu } from "@/features/scheduling/scheduling-grid/components/attendance-menu";
import { DeptModal } from "@/features/scheduling/scheduling-grid/components/dept-modal";
import { EligiblePicker } from "@/features/scheduling/scheduling-grid/components/eligible-picker";
import { EventModal } from "@/features/scheduling/scheduling-grid/components/event-modal";
import { LineModal } from "@/features/scheduling/scheduling-grid/components/line-modal";
import { PtoDecisionMenu } from "@/features/scheduling/scheduling-grid/components/pto-decision-menu";
import { useGrid } from "@/features/scheduling/scheduling-grid/hooks/use-grid";
import type { GridActionRunners } from "@/features/scheduling/scheduling-grid/hooks/use-grid-actions";
import type { GridUiState } from "@/features/scheduling/scheduling-grid/hooks/use-grid-ui-state";
import { useRouter } from "next/navigation";

/**
 * Every dialog the grid can open, mounted from the grid's UI state: the
 * eligible-employee picker, attendance marking, PTO decisions, the event /
 * shift-line / department forms, and the two confirmations (publish with
 * untimed shifts, delete a shift line).
 */
export function GridDialogs({
  ui,
  patchUi,
  lines,
  assignments,
  setup,
  availableLocations,
  membersByRole,
  scheduledByDay,
  runners,
}: {
  ui: GridUiState;
  patchUi: (patch: Partial<GridUiState>) => void;
  lines: SchedWeekLine[];
  assignments: SchedAssignment[];
  setup: SetupData;
  availableLocations: ScheduleLocation[];
  membersByRole: Map<string, Set<string>>;
  scheduledByDay: Map<number, Set<string>>;
  runners: GridActionRunners;
}) {
  const router = useRouter();
  const { week, personById, roleName, weeklyCount, weekTimeOff, cellMap, systemAttendance } = useGrid();

  const attendanceAssignment = ui.attendanceId
    ? assignments.find((a) => a.id === ui.attendanceId) ?? null
    : null;
  const pickerLine = ui.picker ? lines.find((l) => l.id === ui.picker!.lineId) ?? null : null;
  const pickerLocation = ui.picker
    ? availableLocations.find((l) => l.id === ui.picker!.locationId) ?? null
    : null;
  const eventLocation = ui.eventModal
    ? availableLocations.find((l) => l.id === ui.eventModal!.locationId) ?? null
    : null;

  return (
    <>
      {ui.lineModal && (
        <LineModal
          weekId={week.id}
          departments={setup.departments}
          roles={setup.roles}
          line={ui.lineModal.line}
          defaultDeptId={ui.lineModal.deptId}
          onClose={() => patchUi({ lineModal: null })}
          onDone={() => {
            patchUi({ lineModal: null });
            router.refresh();
          }}
        />
      )}

      {ui.deptModal && (
        <DeptModal
          dept={ui.deptModal.dept}
          onClose={() => patchUi({ deptModal: null })}
          onDone={() => {
            patchUi({ deptModal: null });
            router.refresh();
          }}
        />
      )}

      {ui.eventModal && eventLocation && (
        <EventModal
          location={eventLocation}
          day={ui.eventModal.day}
          weekStart={week.week_start}
          initial={ui.eventModal.title}
          onClose={() => patchUi({ eventModal: null })}
          onSave={async (title) => {
            const { locationId, day } = ui.eventModal!;
            const res = await runners.event(locationId, day, title);
            if (res?.ok) patchUi({ eventModal: null });
          }}
        />
      )}

      {ui.picker && pickerLine && pickerLocation && (
        <EligiblePicker
          cell={ui.picker}
          line={pickerLine}
          location={pickerLocation}
          people={setup.people}
          settings={setup.settings}
          membersByRole={membersByRole}
          roleName={roleName}
          roles={setup.roles}
          weeklyCount={weeklyCount}
          scheduledByDay={scheduledByDay}
          weekTimeOff={weekTimeOff}
          assignedHere={
            new Set(
              (cellMap.get(`${ui.picker.lineId}|${ui.picker.locationId}|${ui.picker.day}`) ?? [])
                .filter((a) => !a.removed_post_publish)
                .map((a) => a.person_id),
            )
          }
          onClose={() => patchUi({ picker: null })}
          onPick={(personId) => void runners.assign(ui.picker!, personId)}
        />
      )}

      {attendanceAssignment && (
        <AttendanceMenu
          assignment={attendanceAssignment}
          systemStatus={systemAttendance[attendanceAssignment.id]}
          person={personById.get(attendanceAssignment.person_id)}
          onClose={() => patchUi({ attendanceId: null })}
          onMark={async (status, note) => {
            const res = await runners.mark(attendanceAssignment.id, status, note);
            if (res?.ok) patchUi({ attendanceId: null });
          }}
        />
      )}

      {ui.ptoMenu && (
        <PtoDecisionMenu
          chip={ui.ptoMenu.chip}
          day={ui.ptoMenu.day}
          onClose={() => patchUi({ ptoMenu: null })}
          onDecide={async (status) => {
            const res = await runners.timeOff(ui.ptoMenu!.chip.requestId, status);
            if (res?.ok) patchUi({ ptoMenu: null });
          }}
        />
      )}

      <ConfirmDialog
        open={ui.publishConfirm !== null}
        onOpenChange={(open) => !open && patchUi({ publishConfirm: null })}
        title="Publish anyway?"
        description={
          ui.publishConfirm ? (
            <>
              <span className="block">{ui.publishConfirm.error}</span>
              <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-4 text-left">
                {ui.publishConfirm.untimed.slice(0, 10).map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {ui.publishConfirm.untimed.length > 10 && (
                  <li>…and {ui.publishConfirm.untimed.length - 10} more</li>
                )}
              </ul>
            </>
          ) : null
        }
        confirmLabel="Publish anyway"
        onConfirm={async () => {
          if (ui.publishConfirm) await runners.setStatusConfirmed(ui.publishConfirm.status);
        }}
      />

      <ConfirmDialog
        open={ui.lineDelete !== null}
        onOpenChange={(open) => !open && patchUi({ lineDelete: null })}
        title="Delete this shift line?"
        description={
          ui.lineDelete
            ? `${ui.lineDelete.label || roleName(ui.lineDelete.role_id) || "This shift"} and everyone assigned to it this week will be removed from the grid.`
            : null
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (ui.lineDelete) await runners.removeLine(ui.lineDelete.id);
        }}
      />
    </>
  );
}
