import { describe, expect, it } from "vitest";
import { getEventDefinition } from "./registry";
import { effectiveRule, sanitizeAudience, validateRuleInput, type NotificationRuleRow } from "./rule-config";

const pto = getEventDefinition("pto.requested")!;
const published = getEventDefinition("pto.approved")!;
const task = getEventDefinition("task.assigned")!;

function row(partial: Partial<NotificationRuleRow>): NotificationRuleRow {
  return {
    event_type: "pto.requested",
    enabled: true,
    audience: {},
    deliver_dm: true,
    deliver_inbox: true,
    slack_channel_id: null,
    slack_channel_name: null,
    priority: "normal",
    batch_minutes: 0,
    escalate_after_hours: null,
    escalate_roles: [],
    ...partial,
  };
}

describe("effectiveRule", () => {
  it("uses the code default when there's no override", () => {
    expect(effectiveRule(pto, null)).toEqual(pto.defaults);
  });

  it("applies an override and drops unknown roles / ids", () => {
    const r = effectiveRule(
      pto,
      row({
        audience: { roles: ["manager", "bogus"], personIds: ["not-a-uuid", "8b0e0c61-1111-4a2b-9c3d-123456789abc"] },
        escalate_after_hours: 24,
        escalate_roles: ["owner", "nope"],
        slack_channel_id: "C0123",
      }),
    );
    expect(r.audience.roles).toEqual(["manager"]);
    expect(r.audience.personIds).toEqual(["8b0e0c61-1111-4a2b-9c3d-123456789abc"]);
    expect(r.escalateRoles).toEqual(["owner"]);
    expect(r.channelId).toBe("C0123");
  });

  it("ignores a channel on events that may not be posted to channels", () => {
    expect(effectiveRule(published, row({ slack_channel_id: "C0123" })).channelId).toBeNull();
  });

  it("never lets an override re-address a direct event", () => {
    const r = effectiveRule(task, row({ event_type: "task.assigned", audience: { roles: ["owner"], subjects: false } }));
    expect(r.audience).toEqual(task.defaults.audience);
  });
});

describe("sanitizeAudience", () => {
  it("keeps fallback values for missing keys", () => {
    expect(sanitizeAudience({ roles: ["owner"] }, pto.defaults.audience).excludeActor).toBe(true);
    expect(sanitizeAudience("junk", pto.defaults.audience)).toEqual(pto.defaults.audience);
  });
});

describe("validateRuleInput", () => {
  it("accepts a sensible rule", () => {
    const r = validateRuleInput(pto, { ...pto.defaults, escalateAfterHours: 24, escalateRoles: ["owner"] });
    expect(r.ok).toBe(true);
  });

  it("rejects a rule that reaches nobody", () => {
    const r = validateRuleInput(pto, { ...pto.defaults, audience: { roles: [] } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/recipient/) });
  });

  it("rejects a rule with every delivery switched off", () => {
    const r = validateRuleInput(pto, { ...pto.defaults, deliverDm: false, deliverInbox: false });
    expect(r.ok).toBe(false);
  });

  it("allows switching a notification off entirely", () => {
    const r = validateRuleInput(pto, { ...pto.defaults, enabled: false, deliverDm: false, deliverInbox: false, audience: { roles: [] } });
    expect(r.ok).toBe(true);
  });

  it("rejects channels on DM-only events and malformed channel ids", () => {
    expect(validateRuleInput(published, { ...published.defaults, channelId: "C0123" }).ok).toBe(false);
    expect(validateRuleInput(pto, { ...pto.defaults, channelId: "#ops" }).ok).toBe(false);
  });

  it("requires escalation roles when escalation is on", () => {
    expect(validateRuleInput(pto, { ...pto.defaults, escalateAfterHours: 4, escalateRoles: [] }).ok).toBe(false);
  });

  it("bounds batching", () => {
    expect(validateRuleInput(pto, { ...pto.defaults, batchMinutes: 5000 }).ok).toBe(false);
    expect(validateRuleInput(pto, { ...pto.defaults, batchMinutes: 1.5 }).ok).toBe(false);
  });
});
