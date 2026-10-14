import { describe, expect, it } from "vitest";
import { resolveDate } from "@/features/scheduling/time-attendance/lib/resolve-date";

const TODAY = "2026-10-13";

describe("resolveDate", () => {
  it("opens a valid date within the next two weeks", () => {
    expect(resolveDate("2026-10-20", TODAY)).toBe("2026-10-20");
    // Exactly 14 days out is still allowed.
    expect(resolveDate("2026-10-27", TODAY)).toBe("2026-10-27");
  });

  it("opens any past date", () => {
    expect(resolveDate("2024-01-01", TODAY)).toBe("2024-01-01");
  });

  it("falls back to today when the date is too far ahead", () => {
    expect(resolveDate("2026-10-28", TODAY)).toBe(TODAY);
  });

  it("falls back to today for malformed or impossible dates", () => {
    expect(resolveDate("yesterday", TODAY)).toBe(TODAY);
    expect(resolveDate("2026-13-01", TODAY)).toBe(TODAY);
    expect(resolveDate("2026-02-30", TODAY)).toBe(TODAY);
    expect(resolveDate("", TODAY)).toBe(TODAY);
  });

  it("falls back to today when no date was given", () => {
    expect(resolveDate(undefined, TODAY)).toBe(TODAY);
  });
});
