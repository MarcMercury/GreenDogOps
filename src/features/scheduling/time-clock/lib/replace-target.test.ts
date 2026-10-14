import { describe, expect, it } from "vitest";
import { ERRORS } from "@/features/scheduling/time-clock/lib/errors";
import { parseReplaceTarget } from "@/features/scheduling/time-clock/lib/replace-target";

const ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("parseReplaceTarget", () => {
  it("treats null and blank as 'replace nothing'", () => {
    const none = { ok: true, target: { replacePunchId: null, replaceAdjustmentId: null } };
    expect(parseReplaceTarget(null)).toEqual(none);
    expect(parseReplaceTarget("")).toEqual(none);
  });

  it("routes a recorded punch and an approver-added punch to different parameters", () => {
    expect(parseReplaceTarget(`punch:${ID}`)).toEqual({
      ok: true,
      target: { replacePunchId: ID, replaceAdjustmentId: null },
    });
    expect(parseReplaceTarget(`adjustment:${ID}`)).toEqual({
      ok: true,
      target: { replacePunchId: null, replaceAdjustmentId: ID },
    });
  });

  it("accepts an upper-case uuid", () => {
    expect(parseReplaceTarget(`punch:${ID.toUpperCase()}`)).toMatchObject({ ok: true });
  });

  it("rejects a bad id, a missing id and an unknown kind with the same message", () => {
    const bad = { ok: false, error: ERRORS.replace_target_invalid };
    expect(parseReplaceTarget("punch:nope")).toEqual(bad);
    expect(parseReplaceTarget("punch")).toEqual(bad);
    expect(parseReplaceTarget(`review:${ID}`)).toEqual(bad);
  });
});
