import { describe, expect, it } from "vitest";
import {
  buildFormCompletedMessage,
  buildFormSentMessage,
  buildInterviewCompletedMessage,
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
    expect(buildStageChangeMessage("Jane Doe", "Shadow Day", "Offer", null)).toBe(
      "💼 *APPROVED FOR OFFER — Jane Doe* (from Shadow Day)",
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
    interview_date: "2026-10-13",
    start_time: "11:30:00",
    end_time: "12:00:00",
    location: "Green Dog — The Valley",
  };

  it("posts a phone interview with the interviewer", () => {
    expect(
      buildInterviewScheduledMessage("Jane Doe", {
        ...base,
        interview_type: "phone_screen",
        interviewer: "Sarah",
      }),
    ).toBe("📞 *PHONE INTERVIEW SCHEDULED*\nJane Doe\nTuesday, October 13 · 11:30 AM\n*Interviewer: Sarah*");
  });

  it("posts in-person / shadow with the location and who it's with", () => {
    expect(
      buildInterviewScheduledMessage("Jane Doe", {
        ...base,
        interview_type: "working_interview",
        interviewer: "Sarah + Ren",
      }),
    ).toBe(
      "👋 *IN-PERSON / SHADOW SCHEDULED*\nJane Doe\nTuesday, October 13 · 11:30 AM\nGreen Dog — The Valley\n*With: Sarah + Ren*",
    );
  });

  it("falls back to whoever scheduled it", () => {
    expect(
      buildInterviewScheduledMessage(
        "Jane Doe",
        { ...base, interview_type: "phone_screen", interviewer: " " },
        "Marc",
      ),
    ).toBe("📞 *PHONE INTERVIEW SCHEDULED*\nJane Doe\nTuesday, October 13 · 11:30 AM\n_Scheduled by Marc_");
  });
});

describe("interview completed and questionnaire messages", () => {
  it("summarizes a completed interview", () => {
    expect(
      buildInterviewCompletedMessage(
        "Jane Doe",
        { interview_type: "phone_screen", interviewer: "Sarah", overall_grade: "B", recommendation: "advance" },
        "Advance",
      ),
    ).toBe("⭐ *Phone Screen completed — Jane Doe*\nGrade B · Recommendation: *Advance* · Sarah");
  });

  it("covers sent and completed questionnaires", () => {
    expect(buildFormSentMessage("Jane Doe", "CSR Screening Questions", "Marc")).toBe(
      "📝 *Questionnaire sent — CSR Screening Questions*\nJane Doe · sent by Marc",
    );
    expect(buildFormCompletedMessage("Jane Doe", "CSR Screening Questions", "https://x/ats/1?tab=forms")).toBe(
      "✅ *Questionnaire completed — CSR Screening Questions*\nJane Doe · <https://x/ats/1?tab=forms|View answers>",
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
