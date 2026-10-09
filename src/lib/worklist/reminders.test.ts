import { describe, expect, it } from "vitest";
import type { AppUser } from "../auth/permissions";
import {
  describeSchedule,
  nextOccurrence,
  occursOn,
  ordinal,
  previousOccurrence,
  reminderAppliesTo,
  reminderView,
  scheduleError,
  type ReminderRule,
  type ReminderSchedule,
} from "./reminders";

const base: ReminderSchedule = {
  cadence: "weekly",
  weekdays: [],
  month_day: null,
  week_of_month: null,
  month: null,
  starts_on: "2026-01-01",
};

function rule(patch: Partial<ReminderRule> = {}): ReminderRule {
  return {
    ...base,
    weekdays: [1],
    id: "r1",
    title: "Check the schedule",
    details: null,
    href: "/schedule",
    module: null,
    audience_roles: [],
    owner_user_id: null,
    is_active: true,
    sort_order: 1,
    ...patch,
  };
}

function user(patch: Partial<AppUser> = {}): AppUser {
  return {
    id: "u1",
    email: "a@example.com",
    full_name: "A",
    title: null,
    role: "staff",
    is_active: true,
    module_access: {},
    notes: null,
    person_id: null,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
    ...patch,
  };
}

describe("occurrences", () => {
  it("weekly: Mondays only", () => {
    const s = { ...base, weekdays: [1] };
    expect(occursOn(s, "2026-10-05")).toBe(true); // Monday
    expect(occursOn(s, "2026-10-06")).toBe(false);
    expect(previousOccurrence(s, "2026-10-09")).toBe("2026-10-05");
    expect(nextOccurrence(s, "2026-10-05")).toBe("2026-10-12");
  });

  it("monthly_day clamps to short months and -1 is the last day", () => {
    const s31 = { ...base, cadence: "monthly_day" as const, month_day: 31 };
    expect(occursOn(s31, "2026-02-28")).toBe(true);
    expect(occursOn(s31, "2026-04-30")).toBe(true);
    const last = { ...base, cadence: "monthly_day" as const, month_day: -1 };
    expect(nextOccurrence(last, "2028-02-01")).toBe("2028-02-29");
  });

  it("monthly_business_day: 1st and last Mon–Fri", () => {
    const first = { ...base, cadence: "monthly_business_day" as const, month_day: 1 };
    // Nov 1 2026 is a Sunday → first business day is Mon Nov 2.
    expect(nextOccurrence(first, "2026-10-31")).toBe("2026-11-02");
    const last = { ...base, cadence: "monthly_business_day" as const, month_day: -1 };
    // Oct 31 2026 is a Saturday → last business day is Fri Oct 30.
    expect(previousOccurrence(last, "2026-11-01")).toBe("2026-10-30");
  });

  it("monthly_weekday: last Friday, and a 5th weekday that doesn't exist is skipped", () => {
    const lastFri = { ...base, cadence: "monthly_weekday" as const, weekdays: [5], week_of_month: -1 };
    expect(previousOccurrence(lastFri, "2026-10-31")).toBe("2026-10-30");
    const fifthMon = { ...base, cadence: "monthly_weekday" as const, weekdays: [1], week_of_month: 5 };
    // Oct 2026 has no 5th Monday; Nov 2026 has Nov 30.
    expect(nextOccurrence(fifthMon, "2026-10-01")).toBe("2026-11-30");
  });

  it("yearly", () => {
    const s = { ...base, cadence: "yearly" as const, month: 3, month_day: 15 };
    expect(nextOccurrence(s, "2026-10-09")).toBe("2027-03-15");
    expect(previousOccurrence(s, "2026-10-09")).toBe("2026-03-15");
  });

  it("nothing before starts_on", () => {
    const s = { ...base, weekdays: [1], starts_on: "2026-10-07" };
    expect(previousOccurrence(s, "2026-10-09")).toBeNull();
    expect(nextOccurrence(s, "2026-10-01")).toBe("2026-10-12");
    const monthly = { ...base, cadence: "monthly_day" as const, month_day: 1, starts_on: "2026-10-07" };
    expect(previousOccurrence(monthly, "2026-10-20")).toBeNull();
  });
});

describe("reminderView", () => {
  it("is due on the day, overdue after, done once acked, and replaced by the next occurrence", () => {
    const r = rule({ weekdays: [1] });
    expect(reminderView(r, "2026-10-05", new Set()).status).toBe("due");
    expect(reminderView(r, "2026-10-07", new Set()).status).toBe("overdue");
    expect(reminderView(r, "2026-10-07", new Set(["2026-10-05"])).status).toBe("done");
    // Acking last week's occurrence doesn't clear this week's.
    expect(reminderView(r, "2026-10-12", new Set(["2026-10-05"])).status).toBe("due");
  });

  it("has no status before the first occurrence", () => {
    const v = reminderView(rule({ starts_on: "2026-10-10" }), "2026-10-09", new Set());
    expect(v.status).toBeNull();
    expect(v.next).toBe("2026-10-12");
  });
});

describe("reminderAppliesTo", () => {
  it("personal reminders are only for their owner", () => {
    const r = rule({ owner_user_id: "u1" });
    expect(reminderAppliesTo(r, user({ id: "u1" }))).toBe(true);
    expect(reminderAppliesTo(r, user({ id: "u2", role: "owner" }))).toBe(false);
  });

  it("shared reminders follow the role list and the module gate", () => {
    const r = rule({ audience_roles: ["manager"], module: "hr" });
    expect(reminderAppliesTo(r, user({ role: "manager" }))).toBe(true);
    expect(reminderAppliesTo(r, user({ role: "staff" }))).toBe(false);
    expect(reminderAppliesTo(r, user({ role: "manager", module_access: { hr: false } }))).toBe(false);
    // Reporting is admin-only by default, so an all-roles rule on it skips staff.
    expect(reminderAppliesTo(rule({ module: "reporting" }), user({ role: "staff" }))).toBe(false);
  });

  it("inactive rules and users see nothing", () => {
    expect(reminderAppliesTo(rule({ is_active: false }), user())).toBe(false);
    expect(reminderAppliesTo(rule(), user({ is_active: false }))).toBe(false);
  });
});

describe("validation and labels", () => {
  it("rejects incomplete schedules", () => {
    expect(scheduleError({ ...base, weekdays: [] })).toMatch(/at least one day/);
    expect(scheduleError({ ...base, cadence: "monthly_business_day", month_day: 25 })).not.toBeNull();
    expect(scheduleError({ ...base, cadence: "monthly_weekday", weekdays: [1, 2], week_of_month: 1 })).not.toBeNull();
    expect(scheduleError({ ...base, cadence: "yearly", month: 13, month_day: 1 })).not.toBeNull();
    expect(scheduleError({ ...base, weekdays: [7] })).not.toBeNull();
    expect(scheduleError({ ...base, cadence: "monthly_day", month_day: -1 })).toBeNull();
  });

  it("describes schedules in plain English", () => {
    expect(describeSchedule({ ...base, weekdays: [1, 2, 3, 4, 5] })).toBe("Every weekday");
    expect(describeSchedule({ ...base, weekdays: [1] })).toBe("Every Monday");
    expect(describeSchedule({ ...base, cadence: "monthly_business_day", month_day: -1 })).toBe(
      "Last business day of the month",
    );
    expect(describeSchedule({ ...base, cadence: "monthly_weekday", weekdays: [5], week_of_month: -1 })).toBe(
      "Last Friday of the month",
    );
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal).join(" ")).toBe(
      "1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd",
    );
  });
});
