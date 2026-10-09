import { describe, expect, it } from "vitest";
import {
  addMinutesToTime,
  interviewClinic,
  interviewTypeForStage,
  locationForType,
  minutesBetween,
  prefillInterview,
  roundToQuarterHour,
  PHONE_LOCATION,
  VIDEO_LOCATION,
  type InterviewPrefillContext,
} from "./interview-prefill";

const ctx = (over: Partial<InterviewPrefillContext> = {}): InterviewPrefillContext => ({
  today: "2026-10-09",
  now: "12:38",
  me: { name: "Marc Mercury", defaultDuration: 45 },
  stage: null,
  clinic: "Venice",
  pendingInvite: null,
  ...over,
});

const blank = {
  interview_date: null,
  start_time: null,
  end_time: null,
  interview_type: null,
  interviewer: null,
  location: null,
};

describe("time helpers", () => {
  it("adds minutes, and gives up past midnight instead of wrapping", () => {
    expect(addMinutesToTime("09:45", 30)).toBe("10:15");
    expect(addMinutesToTime("09:45:00", 90)).toBe("11:15");
    expect(addMinutesToTime("23:45", 30)).toBe("");
    expect(addMinutesToTime("", 30)).toBe("");
    expect(addMinutesToTime("10:00", 0)).toBe("");
  });

  it("measures a duration only when end is after start", () => {
    expect(minutesBetween("11:00", "11:30")).toBe(30);
    expect(minutesBetween("11:00:00", "12:15:00")).toBe(75);
    expect(minutesBetween("11:00", "10:00")).toBeNull();
    expect(minutesBetween("11:00", null)).toBeNull();
  });

  it("rounds to the nearest quarter hour within the day", () => {
    expect(roundToQuarterHour("12:38")).toBe("12:45");
    expect(roundToQuarterHour("12:37")).toBe("12:30");
    expect(roundToQuarterHour("09:00")).toBe("09:00");
    expect(roundToQuarterHour("23:56")).toBe("23:45");
    expect(roundToQuarterHour("nope")).toBe("");
  });
});

describe("interview type, location and clinic", () => {
  it("maps pipeline stages to the interview they're due for", () => {
    expect(interviewTypeForStage("New Lead")).toBe("phone_screen");
    expect(interviewTypeForStage("Phone Screen")).toBe("phone_screen");
    expect(interviewTypeForStage("Interview")).toBe("in_person");
    expect(interviewTypeForStage("Shadow Day")).toBe("working_interview");
    expect(interviewTypeForStage("Offer")).toBeNull();
    expect(interviewTypeForStage(null)).toBeNull();
  });

  it("puts phone/video interviews on a call and in-clinic ones at the clinic", () => {
    expect(locationForType("phone_screen", "Venice")).toBe(PHONE_LOCATION);
    expect(locationForType("doc_call", "Venice")).toBe(PHONE_LOCATION);
    expect(locationForType("virtual", "Venice")).toBe(VIDEO_LOCATION);
    expect(locationForType("in_person", "Venice")).toBe("Venice");
    expect(locationForType("working_interview", null)).toBe("");
    expect(locationForType("", "Venice")).toBe("");
  });

  it("prefers the job opening's clinic and never uses Remote", () => {
    expect(interviewClinic("Van Nuys", "Venice")).toBe("Van Nuys");
    expect(interviewClinic(null, "Venice")).toBe("Venice");
    expect(interviewClinic(null, "Remote")).toBeNull();
    expect(interviewClinic("  ", null)).toBeNull();
  });
});

describe("prefillInterview — new interview", () => {
  it("fills today, now, the logged-in interviewer and the stage's interview", () => {
    expect(prefillInterview(null, ctx({ stage: "Interview" }))).toEqual({
      interview_date: "2026-10-09",
      start_time: "12:45",
      end_time: "13:30",
      interview_type: "in_person",
      interviewer: "Marc Mercury",
      location: "Venice",
      duration: 45,
    });
  });

  it("takes type, interviewer, location and length from a pending scheduling link", () => {
    const v = prefillInterview(
      null,
      ctx({
        stage: "Interview",
        pendingInvite: {
          interview_type: "phone_screen",
          host_name: "Dr. Archie",
          location: "Phone call — we'll call the number on your application.",
          duration_minutes: 20,
        },
      }),
    );
    expect(v.interview_type).toBe("phone_screen");
    expect(v.interviewer).toBe("Dr. Archie");
    expect(v.location).toBe("Phone call — we'll call the number on your application.");
    expect(v.end_time).toBe("13:05");
  });

  it("falls back to 30 minutes and leaves unknowns blank", () => {
    const v = prefillInterview(null, ctx({ me: null, clinic: null, stage: "Offer" }));
    expect(v.interviewer).toBe("");
    expect(v.interview_type).toBe("");
    expect(v.location).toBe("");
    expect(v.end_time).toBe("13:15");
  });
});

describe("prefillInterview — existing interview", () => {
  it("keeps everything a booked interview records", () => {
    const booked = {
      interview_date: "2026-11-10",
      start_time: "11:00:00",
      end_time: "11:30:00",
      interview_type: "phone_screen",
      interviewer: "Dr. Archie",
      location: "Clinic back office",
    };
    expect(prefillInterview(booked, ctx({ stage: "Interview" }))).toEqual({
      interview_date: "2026-11-10",
      start_time: "11:00",
      end_time: "11:30",
      interview_type: "phone_screen",
      interviewer: "Dr. Archie",
      location: "Clinic back office",
      duration: 30,
    });
  });

  it("fills only the blanks — never invents a date, time or type", () => {
    const v = prefillInterview({ ...blank, interview_date: "2026-10-06", start_time: "23:00:00" }, ctx({ stage: "Interview" }));
    expect(v.interview_date).toBe("2026-10-06");
    expect(v.start_time).toBe("23:00");
    expect(v.end_time).toBe("23:45");
    expect(v.interview_type).toBe("");
    expect(v.interviewer).toBe("Marc Mercury");
    expect(v.location).toBe("");
  });

  it("leaves a dateless interview dateless", () => {
    const v = prefillInterview({ ...blank, interview_type: "phone_screen" }, ctx());
    expect(v.interview_date).toBe("");
    expect(v.start_time).toBe("");
    expect(v.end_time).toBe("");
    expect(v.location).toBe(PHONE_LOCATION);
  });
});
