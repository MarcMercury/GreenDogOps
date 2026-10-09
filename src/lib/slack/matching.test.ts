import { describe, expect, it } from "vitest";
import {
  indexMembersByEmail,
  planDiffers,
  planSlackLinks,
  searchSlackMembers,
  type SlackLinkState,
  type SlackMember,
} from "./matching";

function member(id: string, email: string | null, extra: Partial<SlackMember> = {}): SlackMember {
  return {
    id,
    teamId: "T1",
    username: id.toLowerCase(),
    email,
    displayName: null,
    realName: null,
    deleted: false,
    isBot: false,
    ...extra,
  };
}

function link(personId: string, extra: Partial<SlackLinkState> = {}): SlackLinkState {
  return {
    personId,
    status: "connected",
    slackUserId: null,
    slackTeamId: "T1",
    slackEmail: null,
    slackDisplayName: null,
    slackRealName: null,
    matchMethod: "email",
    lastError: null,
    ...extra,
  };
}

describe("planSlackLinks — email matching", () => {
  it("connects on exactly one case-insensitive email match", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["  Sarah@GreenDog.com "] }],
      [],
      [member("U1", "sarah@greendog.com", { realName: "Sarah Smith" })],
    );
    expect(plan).toMatchObject({
      status: "connected",
      slackUserId: "U1",
      slackTeamId: "T1",
      slackEmail: "sarah@greendog.com",
      slackRealName: "Sarah Smith",
      matchMethod: "email",
      newlyConnected: true,
      lastError: null,
    });
  });

  it("matches any of the person's emails (HR email or login email)", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["personal@gmail.com", "work@greendog.com"] }],
      [],
      [member("U1", "work@greendog.com")],
    );
    expect(plan.status).toBe("connected");
    expect(plan.slackUserId).toBe("U1");
  });

  it("is not_found when no Slack account uses the email", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["john@greendog.com"] }],
      [],
      [member("U1", "someone@greendog.com")],
    );
    expect(plan.status).toBe("not_found");
    expect(plan.slackUserId).toBeNull();
  });

  it("explains a missing Ops email", () => {
    const [plan] = planSlackLinks([{ personId: "p1", emails: [] }], [], []);
    expect(plan.status).toBe("not_found");
    expect(plan.lastError).toMatch(/no email/);
  });

  it("is ambiguous when the person's emails hit two Slack accounts", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["a@x.com", "b@x.com"] }],
      [],
      [member("U1", "a@x.com"), member("U2", "b@x.com")],
    );
    expect(plan.status).toBe("ambiguous");
    expect(plan.slackUserId).toBeNull();
  });

  it("never matches by name", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@gmail.com"] }],
      [],
      [member("U1", "sarah.smith@greendog.com", { realName: "Sarah Smith", displayName: "sarah" })],
    );
    expect(plan.status).toBe("not_found");
  });

  it("ignores deactivated accounts, bots and Slackbot", () => {
    const plans = planSlackLinks(
      [
        { personId: "p1", emails: ["gone@x.com"] },
        { personId: "p2", emails: ["bot@x.com"] },
        { personId: "p3", emails: ["slackbot@x.com"] },
      ],
      [],
      [
        member("U1", "gone@x.com", { deleted: true }),
        member("U2", "bot@x.com", { isBot: true }),
        member("USLACKBOT", "slackbot@x.com"),
      ],
    );
    expect(plans.map((p) => p.status)).toEqual(["not_found", "not_found", "not_found"]);
  });

  it("refuses to give two people the same Slack account", () => {
    const plans = planSlackLinks(
      [
        { personId: "p1", emails: ["shared@x.com"] },
        { personId: "p2", emails: ["shared@x.com"] },
      ],
      [],
      [member("U1", "shared@x.com")],
    );
    expect(plans.map((p) => p.status)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("won't auto-assign a Slack account another person's link holds", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p2", emails: ["sarah@x.com"] }],
      // p1 is outside this run (e.g. a former employee) but still holds U1.
      [link("p1", { slackUserId: "U1" })],
      [member("U1", "sarah@x.com")],
    );
    expect(plan.status).toBe("ambiguous");
    expect(plan.lastError).toMatch(/already linked/);
  });
});

describe("planSlackLinks — existing links", () => {
  it("keeps a connected link by id even after the Slack email changes", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { slackUserId: "U1", slackEmail: "sarah@x.com" })],
      [member("U1", "sarah.new@x.com", { displayName: "sarah" }), member("U2", "sarah@x.com")],
    );
    expect(plan).toMatchObject({
      status: "connected",
      slackUserId: "U1",
      slackEmail: "sarah.new@x.com",
      slackDisplayName: "sarah",
      newlyConnected: false,
    });
  });

  it("keeps a manual link even though the emails differ", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["john@greendog.com"] }],
      [link("p1", { slackUserId: "U9", matchMethod: "manual" })],
      [member("U9", "john.personal@gmail.com")],
    );
    expect(plan.status).toBe("connected");
    expect(plan.matchMethod).toBe("manual");
  });

  it("marks a deactivated Slack account inactive and keeps its id", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { slackUserId: "U1" })],
      [member("U1", "sarah@x.com", { deleted: true })],
    );
    expect(plan).toMatchObject({ status: "inactive", slackUserId: "U1" });
    expect(plan.lastError).toMatch(/deactivated/);
  });

  it("marks a Slack account that left the workspace inactive", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { slackUserId: "U1" })],
      [],
    );
    expect(plan).toMatchObject({ status: "inactive", slackUserId: "U1" });
  });

  it("does not silently re-match an inactive link to a different account", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { status: "inactive", slackUserId: "U1" })],
      [member("U1", "sarah@x.com", { deleted: true }), member("U2", "sarah@x.com")],
    );
    expect(plan).toMatchObject({ status: "inactive", slackUserId: "U1" });
  });

  it("reconnects when the same Slack account is reactivated", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { status: "inactive", slackUserId: "U1", lastError: "old" })],
      [member("U1", "sarah@x.com")],
    );
    expect(plan).toMatchObject({
      status: "connected",
      slackUserId: "U1",
      newlyConnected: true,
      lastError: null,
    });
  });

  it("leaves an admin-disconnected link alone", () => {
    const existing = link("p1", { status: "disconnected", slackUserId: "U1" });
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [existing],
      [member("U1", "sarah@x.com")],
    );
    expect(plan.status).toBe("disconnected");
    expect(planDiffers(plan, existing)).toBe(false);
  });

  it("re-matches a disconnected link when an admin asks to retry", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { status: "disconnected", slackUserId: "U1" })],
      [member("U1", "sarah@x.com")],
      new Set(["p1"]),
    );
    expect(plan).toMatchObject({ status: "connected", slackUserId: "U1", newlyConnected: true });
  });

  it("retrying a connected person releases their own hold on the account", () => {
    const [plan] = planSlackLinks(
      [{ personId: "p1", emails: ["sarah@x.com"] }],
      [link("p1", { slackUserId: "U1" })],
      [member("U1", "sarah@x.com")],
      new Set(["p1"]),
    );
    expect(plan).toMatchObject({ status: "connected", slackUserId: "U1", newlyConnected: false });
  });
});

describe("planSlackLinks — one Slack account, one connected person", () => {
  function connectedIds(plans: { status: string; slackUserId: string | null }[]) {
    return plans.filter((p) => p.status === "connected").map((p) => p.slackUserId);
  }

  it("keeps an inactive link inactive when its returning account is now someone else's", () => {
    const plans = planSlackLinks(
      [
        { personId: "a", emails: ["a@x.com"] },
        { personId: "b", emails: ["b@x.com"] },
      ],
      [
        link("a", { status: "inactive", slackUserId: "U1" }),
        link("b", { slackUserId: "U1", matchMethod: "manual" }),
      ],
      [member("U1", "a@x.com")],
    );
    expect(plans[0]).toMatchObject({ status: "inactive", slackUserId: "U1" });
    expect(plans[0].lastError).toMatch(/another person/);
    expect(plans[1]).toMatchObject({ status: "connected", slackUserId: "U1" });
    expect(connectedIds(plans)).toEqual(["U1"]);
  });

  it("a reconnecting inactive link claims its account before anyone is email-matched", () => {
    const plans = planSlackLinks(
      [
        { personId: "b", emails: ["shared@x.com"] },
        { personId: "a", emails: ["a@x.com"] },
      ],
      [
        link("a", { status: "inactive", slackUserId: "U1" }),
        link("b", { status: "not_found", slackUserId: null, matchMethod: null }),
      ],
      [member("U1", "shared@x.com")],
    );
    expect(plans[0]).toMatchObject({ status: "ambiguous", slackUserId: null });
    expect(plans[1]).toMatchObject({ status: "connected", slackUserId: "U1" });
    expect(connectedIds(plans)).toEqual(["U1"]);
  });

  it("only one of two inactive links to the same returning account reconnects", () => {
    const plans = planSlackLinks(
      [
        { personId: "a", emails: [] },
        { personId: "c", emails: [] },
      ],
      [
        link("a", { status: "inactive", slackUserId: "U1" }),
        link("c", { status: "inactive", slackUserId: "U1" }),
      ],
      [member("U1", "x@x.com")],
    );
    expect(connectedIds(plans)).toEqual(["U1"]);
    expect(plans.map((p) => p.status)).toEqual(["connected", "inactive"]);
  });
});

describe("planDiffers", () => {
  it("is true for a person with no stored link", () => {
    const [plan] = planSlackLinks([{ personId: "p1", emails: [] }], [], []);
    expect(planDiffers(plan, undefined)).toBe(true);
  });

  it("is false when a re-run reaches the same result", () => {
    const existing = link("p1", {
      status: "not_found",
      slackUserId: null,
      slackTeamId: null,
      matchMethod: null,
      lastError: "No active Slack account uses this person's email.",
    });
    const [plan] = planSlackLinks([{ personId: "p1", emails: ["a@x.com"] }], [existing], []);
    expect(planDiffers(plan, existing)).toBe(false);
  });
});

describe("indexMembersByEmail", () => {
  it("skips members without an email", () => {
    const idx = indexMembersByEmail([member("U1", null), member("U2", "A@x.com")]);
    expect([...idx.keys()]).toEqual(["a@x.com"]);
  });
});

describe("searchSlackMembers", () => {
  const members = [
    member("U1", "john.personal@gmail.com", { realName: "John Doe", username: "john" }),
    member("U2", "jane@x.com", { realName: "Jane Doe" }),
    member("U3", "jd@x.com", { realName: "John Deactivated", deleted: true }),
  ];

  it("matches every word across name, handle and email", () => {
    expect(searchSlackMembers(members, "john doe").map((m) => m.id)).toEqual(["U1"]);
    expect(searchSlackMembers(members, "gmail").map((m) => m.id)).toEqual(["U1"]);
  });

  it("excludes deactivated accounts and returns nothing for an empty query", () => {
    expect(searchSlackMembers(members, "john").map((m) => m.id)).toEqual(["U1"]);
    expect(searchSlackMembers(members, "   ")).toEqual([]);
  });
});
