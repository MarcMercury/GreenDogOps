import { describe, expect, it } from "vitest";
import {
  allowedPunches,
  canPunch,
  clockState,
  hasAbandonedSession,
  isPunchType,
  PUNCH_TYPES,
  STALE_SESSION_HOURS,
} from "./state";

const NOW = new Date("2026-10-13T20:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("clockState", () => {
  it("is off with no punches or after a clock-out", () => {
    expect(clockState(null, NOW)).toBe("off");
    expect(clockState({ punch_type: "clock_out", punched_at: ago(1) }, NOW)).toBe("off");
  });

  it("is working after a clock-in or the end of lunch, on lunch after starting it", () => {
    expect(clockState({ punch_type: "clock_in", punched_at: ago(2) }, NOW)).toBe("working");
    expect(clockState({ punch_type: "lunch_end", punched_at: ago(1) }, NOW)).toBe("working");
    expect(clockState({ punch_type: "lunch_start", punched_at: ago(0.2) }, NOW)).toBe("on_lunch");
  });

  it(`treats a session idle for more than ${STALE_SESSION_HOURS}h as abandoned`, () => {
    const stale = { punch_type: "clock_in" as const, punched_at: ago(STALE_SESSION_HOURS + 0.1) };
    expect(clockState(stale, NOW)).toBe("off");
    expect(hasAbandonedSession(stale, NOW)).toBe(true);
    expect(clockState({ punch_type: "clock_in", punched_at: ago(STALE_SESSION_HOURS - 0.1) }, NOW)).toBe("working");
    expect(hasAbandonedSession({ punch_type: "clock_out", punched_at: ago(30) }, NOW)).toBe(false);
    expect(hasAbandonedSession(null, NOW)).toBe(false);
  });
});

describe("allowed punches (mirrors record_time_punch in 0240)", () => {
  it("allows exactly the documented transitions", () => {
    expect(allowedPunches("off")).toEqual(["clock_in"]);
    expect(allowedPunches("working")).toEqual(["lunch_start", "clock_out"]);
    expect(allowedPunches("on_lunch")).toEqual(["lunch_end", "clock_out"]);
  });

  it("rejects everything else", () => {
    expect(canPunch("off", "clock_out")).toBe(false);
    expect(canPunch("off", "lunch_start")).toBe(false);
    expect(canPunch("working", "clock_in")).toBe(false);
    expect(canPunch("working", "lunch_end")).toBe(false);
    expect(canPunch("on_lunch", "lunch_start")).toBe(false);
    expect(canPunch("on_lunch", "clock_in")).toBe(false);
  });

  it("validates punch types", () => {
    for (const t of PUNCH_TYPES) expect(isPunchType(t)).toBe(true);
    for (const t of ["", "clockin", "CLOCK_IN", null, 3]) expect(isPunchType(t)).toBe(false);
  });

  it("stays in step with the SQL function", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0240_time_clock.sql"), "utf8");
    expect(sql).toContain(`interval '${STALE_SESSION_HOURS} hours'`);
    expect(sql).toContain("(v_state = 'off'      and p_punch_type = 'clock_in')");
    expect(sql).toContain("(v_state = 'working'  and p_punch_type in ('lunch_start', 'clock_out'))");
    expect(sql).toContain("(v_state = 'on_lunch' and p_punch_type in ('lunch_end', 'clock_out'))");
  });
});
