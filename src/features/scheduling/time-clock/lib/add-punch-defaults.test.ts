import { describe, expect, it } from "vitest";
import { addPunchFormDefaults } from "@/features/scheduling/time-clock/lib/add-punch-defaults";
import { addPunchSchema } from "@/features/scheduling/time-clock/schema/add-punch.schema";

const PERSON = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("addPunchFormDefaults", () => {
  it("fixes the employee and day, pre-selects the missing punch, and starts the rest blank", () => {
    expect(addPunchFormDefaults(PERSON, "2026-10-13", "clock_out")).toEqual({
      person_id: PERSON,
      work_date: "2026-10-13",
      punch_type: "clock_out",
      time: "",
      next_day: false,
      reason: "",
    });
    expect(addPunchFormDefaults(PERSON, "2026-10-13", "clock_in").punch_type).toBe("clock_in");
  });

  it("is the shape the action's schema accepts, boolean checkbox included", () => {
    const parsed = addPunchSchema.safeParse({
      ...addPunchFormDefaults(PERSON, "2026-10-13", "clock_out"),
      time: "17:30",
      next_day: true,
      reason: "Confirmed with the employee",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.next_day).toBe(true);
  });
});
