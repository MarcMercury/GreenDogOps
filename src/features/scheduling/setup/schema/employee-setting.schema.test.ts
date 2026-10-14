import { describe, expect, it } from "vitest";
import { parseInput } from "@/lib/validation/form";
import {
  employeeSettingSchema,
  scheduleSettingFieldsSchema,
} from "./employee-setting.schema";

const PERSON = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";

describe("employeeSettingSchema", () => {
  it("accepts the full row Set Up ▸ Employees saves", () => {
    const parsed = parseInput(employeeSettingSchema, {
      personId: PERSON,
      weeklyTarget: 5,
      isSchedulable: true,
      defaultLocationId: null,
      eligibleLocationIds: [LOC],
      availableDays: [1, 2, 3],
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a weekday outside 0–6 and a non-uuid location", () => {
    expect(
      parseInput(employeeSettingSchema, {
        personId: PERSON,
        weeklyTarget: 5,
        isSchedulable: true,
        defaultLocationId: null,
        eligibleLocationIds: [],
        availableDays: [7],
      }).ok,
    ).toBe(false);
    expect(
      parseInput(employeeSettingSchema, {
        personId: PERSON,
        weeklyTarget: 5,
        isSchedulable: true,
        defaultLocationId: null,
        eligibleLocationIds: ["not-a-uuid"],
        availableDays: [],
      }).ok,
    ).toBe(false);
  });
});

describe("scheduleSettingFieldsSchema", () => {
  it("keeps only the fields the HR profile sent, so the rest of the row is preserved", () => {
    const parsed = parseInput(scheduleSettingFieldsSchema, {
      personId: PERSON,
      fields: { weeklyTarget: 4 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.fields.weeklyTarget).toBe(4);
    expect(parsed.data.fields.isSchedulable).toBeUndefined();
    expect(parsed.data.fields.availableDays).toBeUndefined();
  });
});
