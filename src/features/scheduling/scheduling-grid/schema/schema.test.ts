import { describe, expect, it } from "vitest";
import { ATTENDANCE_LABELS, SCHEDULE_STATUS_LABELS } from "@/lib/schedule/types";
import { assignPersonSchema } from "@/features/scheduling/scheduling-grid/schema/assignment.schema";
import { markAttendanceSchema } from "@/features/scheduling/scheduling-grid/schema/attendance.schema";
import { setEventSchema } from "@/features/scheduling/scheduling-grid/schema/event.schema";
import { generateGuideFromCapacitySchema } from "@/features/scheduling/scheduling-grid/schema/planning-guide.schema";
import { addWeekLineSchema } from "@/features/scheduling/scheduling-grid/schema/week-line.schema";
import { setWeekStatusSchema } from "@/features/scheduling/scheduling-grid/schema/week-status.schema";
import { createWeekSchema, updateWeekMetaSchema } from "@/features/scheduling/scheduling-grid/schema/week.schema";

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("scheduling-grid schemas", () => {
  it("assignPerson accepts a grid cell and rejects a day outside Sun–Sat or a non-uuid", () => {
    const ok = assignPersonSchema.safeParse({ weekId: UUID, lineId: UUID, locationId: UUID2, dayOfWeek: 6, personId: UUID2 });
    expect(ok.success).toBe(true);
    expect(assignPersonSchema.safeParse({ weekId: UUID, lineId: UUID, locationId: UUID2, dayOfWeek: 7, personId: UUID2 }).success).toBe(false);
    expect(assignPersonSchema.safeParse({ weekId: "week-1", lineId: UUID, locationId: UUID2, dayOfWeek: 0, personId: UUID2 }).success).toBe(false);
  });

  it("markAttendance accepts every attendance status (incl. 'scheduled' = clear) and a null note", () => {
    for (const status of Object.keys(ATTENDANCE_LABELS)) {
      expect(markAttendanceSchema.safeParse({ assignmentId: UUID, status, note: null }).success).toBe(true);
    }
    expect(markAttendanceSchema.safeParse({ assignmentId: UUID, status: "vacation", note: null }).success).toBe(false);
  });

  it("setWeekStatus accepts every workflow status and an optional confirmUntimed", () => {
    for (const status of Object.keys(SCHEDULE_STATUS_LABELS)) {
      expect(setWeekStatusSchema.safeParse({ weekId: UUID, status }).success).toBe(true);
    }
    expect(setWeekStatusSchema.safeParse({ weekId: UUID, status: "published", confirmUntimed: true }).success).toBe(true);
    expect(setWeekStatusSchema.safeParse({ weekId: UUID, status: "live" }).success).toBe(false);
  });

  it("week lines must end after they start, and blank times are allowed", () => {
    const fd = (start: string, end: string) => ({ week_id: UUID, department_id: UUID2, sort_order: "10", start_time: start, end_time: end });
    expect(addWeekLineSchema.safeParse(fd("08:00", "16:00")).success).toBe(true);
    expect(addWeekLineSchema.safeParse(fd("", "")).success).toBe(true);
    const bad = addWeekLineSchema.safeParse(fd("16:00", "08:00"));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toBe("End time must be after start time.");
  });

  it("setEvent keeps a blank title (the action treats it as 'clear')", () => {
    const parsed = setEventSchema.safeParse({ weekId: UUID, locationId: UUID2, dayOfWeek: 2, title: "" });
    expect(parsed.success && parsed.data.title).toBe("");
  });

  it("updateWeekMeta passes title and notes through untouched, null included", () => {
    const parsed = updateWeekMetaSchema.safeParse({ weekId: UUID, title: " Spring ", notes: null });
    expect(parsed.success && parsed.data).toEqual({ weekId: UUID, title: " Spring ", notes: null });
  });

  it("createWeek wants a YYYY-MM-DD week start", () => {
    expect(createWeekSchema.safeParse({ weekStart: "2026-10-04" }).success).toBe(true);
    expect(createWeekSchema.safeParse({ weekStart: "10/04/2026" }).success).toBe(false);
  });

  it("generateGuideFromCapacity takes the tile's appointment number as-is", () => {
    const parsed = generateGuideFromCapacitySchema.safeParse({ weekId: UUID, day: 1, locationId: UUID2, departmentId: UUID, targetAppointments: 12.5 });
    expect(parsed.success && parsed.data.targetAppointments).toBe(12.5);
  });
});
