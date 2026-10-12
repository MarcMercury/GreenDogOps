import { describe, expect, it } from "vitest";
import { planFanout } from "./plan";
import { getEventDefinition } from "./registry";
import type { ResolvedRecipient, RuleConfig } from "./types";

const now = new Date("2026-10-19T17:00:00Z");

function recipient(p: Partial<ResolvedRecipient> & { personId: string }): ResolvedRecipient {
  return { userId: null, slackUserId: null, isSubject: false, reasons: ["role:schedule_admin"], canAct: false, moduleAccess: false, ...p };
}

function plan(type: string, rule: Partial<RuleConfig>, recipients: ResolvedRecipient[], opts: { escalation?: boolean } = {}) {
  const def = getEventDefinition(type)!;
  return planFanout({
    def,
    rule: { ...def.defaults, ...rule },
    event: { id: "ev1", type, subjectId: "t1", payload: { personId: "p1", personName: "Jane", dates: "Nov 12", note: "Family trip", weekId: "w1", weekStart: "2026-10-18", shifts: { p1: ["Mon"] }, dateLabel: "Tue, Oct 20", reason: "No Show", locationName: "Aetna" } },
    recipients,
    now,
    escalation: opts.escalation,
  });
}

describe("planFanout", () => {
  it("writes an inbox row only for people with a login, and skips DMs without Slack", () => {
    const p = plan("pto.requested", {}, [
      recipient({ personId: "a", userId: "ua", slackUserId: "UA", canAct: true }),
      recipient({ personId: "b" }),
    ]);
    const [a, b] = p.recipients;
    expect(a.inbox?.userId).toBe("ua");
    expect(a.dm?.status).toBe("pending");
    expect(b.inbox).toBeNull();
    expect(b.dm).toMatchObject({ status: "skipped", lastError: expect.stringMatching(/no connected slack/i) });
  });

  it("requires module access at send time for non-subjects of restricted events", () => {
    const p = plan("pto.approved", {}, [
      recipient({ personId: "emp", isSubject: true, slackUserId: "UE" }),
      recipient({ personId: "mgr", slackUserId: "UM", userId: "um" }),
    ]);
    expect(p.recipients[0].dm?.requiredModule).toBeNull();
    expect(p.recipients[1].dm?.requiredModule).toBe("schedule");
  });

  it("gives approve/deny buttons only to recipients who can act", () => {
    const p = plan("pto.requested", {}, [
      recipient({ personId: "a", slackUserId: "UA", userId: "ua", canAct: true }),
      recipient({ personId: "b", slackUserId: "UB", userId: "ub", canAct: false }),
    ]);
    expect(p.recipients[0].dm?.card.actions).toEqual(["pto.approve", "pto.deny"]);
    expect(p.recipients[1].dm?.card.actions).toEqual([]);
    expect(p.recipients[0].dm?.messageKey).toBe("pto:t1");
  });

  it("drops app links for people without a login", () => {
    const p = plan("pto.requested", {}, [recipient({ personId: "a", slackUserId: "UA" })]);
    expect(p.recipients[0].dm?.href).toBeNull();
  });

  it("holds batched deliveries and gives them a coalesce key", () => {
    const p = plan("schedule.shift_changed", { batchMinutes: 10 }, [
      recipient({ personId: "p1", isSubject: true, slackUserId: "U1" }),
    ]);
    const dm = p.recipients[0].dm!;
    expect(dm.batched).toBe(true);
    expect(dm.sendAt.getTime()).toBe(now.getTime() + 10 * 60_000);
    expect(dm.coalesceKey).toBe("shift:w1:p1");
  });

  it("keys shift batching by the affected employee, so a watcher's updates about two people don't merge", () => {
    const def = getEventDefinition("schedule.shift_changed")!;
    expect(def.coalesceKey!({ weekId: "w1", personId: "alice" })).not.toBe(def.coalesceKey!({ weekId: "w1", personId: "bob" }));
  });

  it("only shows who is out (and why) to recipients who can open Scheduling", () => {
    const p = plan("schedule.coverage_needed", {}, [
      recipient({ personId: "admin", slackUserId: "UA", userId: "ua", moduleAccess: true }),
      recipient({ personId: "peer", slackUserId: "UP", reasons: ["candidate"], moduleAccess: false }),
    ]);
    const [adminCopy, peerCopy] = p.recipients.map((r) => r.dm!);
    expect(adminCopy.title).toMatch(/Jane/);
    expect(JSON.stringify(adminCopy.card)).toMatch(/No Show/);
    expect(adminCopy.requiredModule).toBe("schedule");
    expect(peerCopy.title).toBe("Open shift: Tue, Oct 20");
    expect(JSON.stringify(peerCopy.card)).not.toMatch(/Jane|No Show/);
    expect(peerCopy.requiredModule).toBeNull();
  });

  it("sends escalations right away, relabelled", () => {
    const p = plan("pto.requested", { batchMinutes: 30 }, [recipient({ personId: "a", slackUserId: "UA", userId: "ua" })], {
      escalation: true,
    });
    const dm = p.recipients[0].dm!;
    expect(dm.batched).toBe(false);
    expect(dm.title).toMatch(/^Still waiting:/);
    expect(dm.audienceReason).toMatch(/^escalation/);
    expect(p.recipients[0].inbox?.dedupeKey).toBe("ev1:escalation");
  });

  it("posts to a channel without personal notes", () => {
    const p = plan("pto.requested", { channelId: "C123", channelName: "ops" }, []);
    expect(p.channel?.slackChannelId).toBe("C123");
    expect(p.channel?.body ?? "").not.toMatch(/Family trip/);
    const dm = plan("pto.requested", {}, [recipient({ personId: "a", slackUserId: "UA", userId: "ua" })]).recipients[0].dm;
    expect(dm?.body).toMatch(/Family trip/);
  });

  it("respects delivery switches", () => {
    const p = plan("pto.requested", { deliverDm: false, deliverInbox: false }, [
      recipient({ personId: "a", slackUserId: "UA", userId: "ua" }),
    ]);
    expect(p.recipients[0].dm).toBeNull();
    expect(p.recipients[0].inbox).toBeNull();
  });

  it("gives each scheduled employee only their own shifts", () => {
    const p = plan("schedule.published", {}, [
      recipient({ personId: "p1", isSubject: true, slackUserId: "U1" }),
      recipient({ personId: "p2", isSubject: true, slackUserId: "U2" }),
    ]);
    expect(p.recipients[0].dm?.card.msg.lines).toEqual(["Mon"]);
    expect(p.recipients[1].dm?.card.msg.lines).toEqual(["No shifts scheduled for you this week."]);
  });
});
