import { describe, expect, it } from "vitest";
import {
  buildInterviewScheduledMessage,
  buildJobChangeMessage,
  buildStageChangeMessage,
} from "./slack-messages";

describe("buildStageChangeMessage", () => {
  it("stars forward moves", () => {
    expect(buildStageChangeMessage("Jane Doe", "New Lead", "Phone Screen", "Sarah")).toBe(
      "⭐ *Jane Doe* advanced to *Phone Screen* (from New Lead) — Sarah",
    );
  });

  it("calls out offers and hires", () => {
    expect(buildStageChangeMessage("Jane Doe", "Doc Call", "Offer", null)).toBe(
      "💼 *Jane Doe* approved for an offer (from Doc Call)",
    );
    expect(buildStageChangeMessage("Jane Doe", "Offer", "Hired", null)).toBe(
      "🎉 *Jane Doe* moved to *Hired* (from Offer)",
    );
  });

  it("marks backward and closing moves without a star", () => {
    expect(buildStageChangeMessage("Jane Doe", "Offer", "Phone Screen", null)).toBe(
      "↩️ *Jane Doe* moved back to *Phone Screen* (from Offer)",
    );
    expect(buildStageChangeMessage("Jane Doe", "Phone Screen", "Passed", null)).toBe(
      "🚫 *Jane Doe* moved to *Passed* (from Phone Screen)",
    );
    expect(buildStageChangeMessage("Jane Doe", null, "New Lead", null)).toBe(
      "*Jane Doe* moved to *New Lead*",
    );
  });

  it("escapes Slack control characters", () => {
    expect(buildStageChangeMessage("<Jane>", null, "Contacted", "A&B")).toBe(
      "⭐ *&lt;Jane&gt;* advanced to *Contacted* — A&amp;B",
    );
  });
});

describe("buildInterviewScheduledMessage", () => {
  const base = {
    interview_date: "2026-10-07",
    start_time: "10:00:00",
    end_time: "10:30:00",
    location: "Zoom",
  };

  it("says who is interviewing whom, and when", () => {
    expect(
      buildInterviewScheduledMessage("Jane Doe", {
        ...base,
        interview_type: "phone_screen",
        interviewer: "Sarah",
      }),
    ).toBe(
      "☎️ *Phone Screen scheduled — Jane Doe*\nSarah is interviewing Jane Doe · Wed, Oct 7 · 10:00 AM–10:30 AM · Zoom",
    );
  });

  it("uses the wave for in-person / shadow and falls back to the scheduler", () => {
    expect(
      buildInterviewScheduledMessage(
        "Jane Doe",
        { ...base, interview_type: "working_interview", interviewer: " " },
        "Marc",
      ),
    ).toBe(
      "👋 *Working Interview / Shadow Day scheduled — Jane Doe*\nScheduled by Marc · Wed, Oct 7 · 10:00 AM–10:30 AM · Zoom",
    );
  });
});

describe("buildJobChangeMessage", () => {
  it("announces a first assignment", () => {
    expect(buildJobChangeMessage("Jane Doe", null, "CSR — Van Nuys", "Marc")).toBe(
      "💼 *Jane Doe* assigned to job *CSR — Van Nuys* — Marc",
    );
  });

  it("shows where a reassigned candidate came from", () => {
    expect(buildJobChangeMessage("Jane Doe", "CSR — Van Nuys", "Vet Tech — Venice", null)).toBe(
      "💼 *Jane Doe* moved to job *Vet Tech — Venice* (from CSR — Van Nuys)",
    );
  });

  it("covers removing the job", () => {
    expect(buildJobChangeMessage("Jane Doe", "CSR — Van Nuys", null, null)).toBe(
      "💼 *Jane Doe* removed from job *CSR — Van Nuys*",
    );
  });
});
