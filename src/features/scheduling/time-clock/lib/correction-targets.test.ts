import { describe, expect, it } from "vitest";
import { correctionTargets } from "./correction-targets";

const fmt = (iso: string) => `@${iso.slice(11, 16)}`;

const punch = (over: Partial<Parameters<typeof correctionTargets>[0]["day_punches"][number]> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  punch_type: "clock_in" as const,
  punched_at: "2026-10-13T15:02:00Z",
  origin: "punch" as const,
  ...over,
});

describe("correctionTargets", () => {
  it("offers only that day's punches of the requested type", () => {
    const targets = correctionTargets(
      {
        punch_type: "clock_out",
        day_punches: [
          punch(),
          punch({ id: "22222222-2222-4222-8222-222222222222", punch_type: "clock_out", punched_at: "2026-10-13T23:31:00Z" }),
        ],
      },
      fmt,
    );
    expect(targets).toEqual([
      { value: "punch:22222222-2222-4222-8222-222222222222", label: "Clock out at @23:31" },
    ]);
  });

  it("prefixes approver-added punches with adjustment: and labels them (added)", () => {
    const targets = correctionTargets(
      { punch_type: "clock_in", day_punches: [punch({ origin: "adjustment" })] },
      fmt,
    );
    expect(targets).toEqual([
      { value: "adjustment:11111111-1111-4111-8111-111111111111", label: "Clock in at @15:02 (added)" },
    ]);
  });

  it("offers nothing when the request names no punch type", () => {
    expect(correctionTargets({ punch_type: null, day_punches: [punch()] }, fmt)).toEqual([]);
  });
});
