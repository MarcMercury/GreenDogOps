import { describe, expect, it } from "vitest";
import { canUndoRejection, cleanScore, countdown, renderTemplate, suggestedTemplate } from "./rejections";

describe("renderTemplate", () => {
  it("fills placeholders with sensible fallbacks", () => {
    expect(renderTemplate("Hi {first_name}, re: the {role} job. {unknown}", { first_name: "Jane", full_name: null, role: "CSR" })).toBe(
      "Hi Jane, re: the CSR job. {unknown}",
    );
    expect(renderTemplate("Hi {first_name} — {role} / {full_name}", { first_name: null, full_name: null, role: null })).toBe(
      "Hi there — open / there",
    );
  });
});

describe("suggestedTemplate", () => {
  const t = [
    { id: "a", name: "Initial Application Rejection", active: true },
    { id: "s", name: "Post-Screening Rejection", active: true },
    { id: "i", name: "Post-Interview Rejection", active: true },
  ];
  it("picks by where the candidate was rejected", () => {
    expect(suggestedTemplate(t, "review", false)).toBe("a");
    expect(suggestedTemplate(t, "forms", false)).toBe("s");
    expect(suggestedTemplate(t, "interviews", false)).toBe("i");
    expect(suggestedTemplate(t, "profile", true)).toBe("i");
  });
  it("falls back to the first active template", () => {
    expect(suggestedTemplate([{ id: "x", name: "Generic", active: true }], "forms", false)).toBe("x");
    expect(suggestedTemplate([], "forms", false)).toBeNull();
  });
});

describe("countdown / undo / score", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("counts down to the email", () => {
    expect(countdown("2026-10-10T12:00:00Z", now)).toBe("in 48h");
    expect(countdown("2026-10-08T12:20:00Z", now)).toBe("in 20m");
    expect(countdown("2026-10-08T11:00:00Z", now)).toBe("due now");
  });
  it("only undoes before the email goes out", () => {
    expect(canUndoRejection({ email_status: "scheduled", undone_at: null })).toBe(true);
    expect(canUndoRejection({ email_status: "cancelled", undone_at: null })).toBe(true);
    expect(canUndoRejection({ email_status: "sent", undone_at: null })).toBe(false);
  });
  it("cleans scores", () => {
    expect(cleanScore("8.54")).toBe(8.5);
    expect(cleanScore(11)).toBeNull();
    expect(cleanScore("")).toBeNull();
    expect(cleanScore(0)).toBe(0);
  });
});
