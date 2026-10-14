import { describe, expect, it } from "vitest";
import { calendarsFromEnv } from "./calendar-env";

describe("calendarsFromEnv", () => {
  it("syncs every configured calendar with its label and category", () => {
    expect(
      calendarsFromEnv({
        GOOGLE_CALENDAR_ID: "main@gmail.com",
        GOOGLE_COMPANY_CALENDAR_ID: "abc@group.calendar.google.com",
        GOOGLE_DENTAL_CALENDAR_ID: " greendogdental@gmail.com ",
        GOOGLE_SOCIALS_CALENDAR_ID: "greendogsocial@gmail.com",
        GOOGLE_INTERVIEW_CALENDAR_ID: "greendogcareers@gmail.com",
      }),
    ).toEqual([
      { id: "main@gmail.com", category: "google", label: "Company Calendar" },
      { id: "abc@group.calendar.google.com", category: "google", label: "Green Dog Company Calendar" },
      { id: "greendogdental@gmail.com", category: "google", label: "Green Dog Dental Calendar" },
      { id: "greendogsocial@gmail.com", category: "google", label: "Green Dog Socials Calendar" },
      { id: "greendogcareers@gmail.com", category: "interview", label: "Interviews" },
    ]);
  });

  it("skips unset and blank calendars", () => {
    expect(calendarsFromEnv({ GOOGLE_DENTAL_CALENDAR_ID: "d@gmail.com", GOOGLE_CALENDAR_ID: "  " })).toEqual([
      { id: "d@gmail.com", category: "google", label: "Green Dog Dental Calendar" },
    ]);
    expect(calendarsFromEnv({})).toEqual([]);
  });

  it("syncs a calendar set in two variables only once", () => {
    const cals = calendarsFromEnv({ GOOGLE_CALENDAR_ID: "same@gmail.com", GOOGLE_DENTAL_CALENDAR_ID: "same@gmail.com" });
    expect(cals.map((c) => c.label)).toEqual(["Company Calendar"]);
  });
});
