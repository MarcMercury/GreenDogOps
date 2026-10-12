import { describe, expect, it } from "vitest";
import { buildCardBlocks, buildDigestBlocks, fallbackText, parseStoredCard, type StoredCard } from "./slack-blocks";
import { authorizeAction, parseInteraction } from "./interaction-rules";
import type { AppRole, AppUser } from "@/lib/auth/permissions";

const card: StoredCard = {
  msg: {
    emoji: "🏖️",
    title: "Time off <script>",
    body: "A & B",
    fields: [{ label: "Dates", value: "Nov 12" }],
    href: "/schedule?week=w1",
    linkLabel: "Review",
  },
  actions: ["pto.approve", "pto.deny"],
};

const DELIVERY = "8b0e0c61-1111-4a2b-9c3d-123456789abc";

describe("buildCardBlocks", () => {
  it("escapes text, links into the app and carries the delivery id on buttons", () => {
    const blocks = buildCardBlocks(card, { baseUrl: "https://ops.test", deliveryId: DELIVERY, showActions: true });
    const json = JSON.stringify(blocks);
    expect(json).toContain("Time off &lt;script&gt;");
    expect(json).toContain("A &amp; B");
    expect(json).toContain("https://ops.test/schedule?week=w1");
    const actions = blocks.find((b) => b.type === "actions") as { elements: { action_id: string; value?: string }[] };
    expect(actions.elements.map((e) => e.action_id)).toEqual(["gdo:link", "gdo:pto.approve", "gdo:pto.deny"]);
    expect(actions.elements[1].value).toBe(DELIVERY);
  });

  it("removes action buttons once resolved and shows who resolved it", () => {
    const blocks = buildCardBlocks(card, {
      baseUrl: "https://ops.test",
      deliveryId: DELIVERY,
      showActions: true,
      resolvedNote: "✅ Approved by Alex",
    });
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("gdo:pto.approve");
    expect(json).toContain("Approved by Alex");
  });

  it("has a plain-text fallback", () => {
    expect(fallbackText(card.msg)).toBe("🏖️ Time off <script> — A & B");
  });
});

describe("buildDigestBlocks", () => {
  it("stays within Slack's 50-block limit", () => {
    const many = Array.from({ length: 30 }, () => card);
    const blocks = buildDigestBlocks(many, "https://ops.test");
    expect(blocks.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(blocks)).toContain("21 more");
  });
});

describe("parseStoredCard", () => {
  it("round-trips and drops unknown actions", () => {
    expect(parseStoredCard({ ...card, actions: ["pto.approve", "rm -rf"] })?.actions).toEqual(["pto.approve"]);
    expect(parseStoredCard(null)).toBeNull();
    expect(parseStoredCard({ msg: {} })).toBeNull();
  });
});

function login(role: AppRole, overrides: Record<string, boolean> = {}): AppUser {
  return {
    id: "u1",
    email: "a@b.c",
    full_name: "A",
    title: null,
    role,
    is_active: true,
    module_access: overrides,
    notes: null,
    person_id: "p1",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("parseInteraction", () => {
  const base = {
    type: "block_actions",
    user: { id: "U123" },
    response_url: "https://hooks.slack.com/actions/T/1/abc",
    actions: [{ action_id: "gdo:pto.approve", value: DELIVERY, action_ts: "1700000000.1" }],
  };

  it("parses our buttons", () => {
    expect(parseInteraction(base)).toEqual({
      slackUserId: "U123",
      actionId: "pto.approve",
      deliveryId: DELIVERY,
      actionTs: "1700000000.1",
      responseUrl: base.response_url,
    });
  });

  it("rejects foreign or malformed payloads", () => {
    expect(parseInteraction({ ...base, type: "view_submission" })).toBeNull();
    expect(parseInteraction({ ...base, actions: [{ action_id: "other:x", value: DELIVERY }] })).toBeNull();
    expect(parseInteraction({ ...base, actions: [{ action_id: "gdo:pto.approve", value: "1; drop" }] })).toBeNull();
    expect(parseInteraction({ ...base, user: { id: "not-a-user" } })).toBeNull();
    expect(parseInteraction({ ...base, response_url: "https://evil.example/x" })?.responseUrl).toBeNull();
  });
});

describe("authorizeAction", () => {
  const dm = { channel: "slack_dm" as const, slack_user_id: "U123" };

  it("only lets the DM's recipient use its buttons", () => {
    const r = authorizeAction({ action: "ack", delivery: dm, clickerSlackId: "U999", login: null });
    expect(r.ok).toBe(false);
  });

  it("requires Scheduling edit rights to approve time off", () => {
    expect(authorizeAction({ action: "pto.approve", delivery: dm, clickerSlackId: "U123", login: null }).ok).toBe(false);
    expect(authorizeAction({ action: "pto.approve", delivery: dm, clickerSlackId: "U123", login: login("staff") }).ok).toBe(false);
    expect(
      authorizeAction({ action: "pto.deny", delivery: dm, clickerSlackId: "U123", login: login("marketing_admin") }).ok,
    ).toBe(false);
    expect(
      authorizeAction({ action: "pto.approve", delivery: dm, clickerSlackId: "U123", login: login("manager", { schedule: false }) }).ok,
    ).toBe(false);
    expect(authorizeAction({ action: "pto.approve", delivery: dm, clickerSlackId: "U123", login: login("schedule_admin") }).ok).toBe(true);
  });

  it("re-checks a role change between delivery and click", () => {
    const demoted = { ...login("schedule_admin"), is_active: false };
    expect(authorizeAction({ action: "pto.approve", delivery: dm, clickerSlackId: "U123", login: demoted }).ok).toBe(false);
  });

  it("lets anyone in a channel acknowledge, but approvals still need rights", () => {
    const channel = { channel: "slack_channel" as const, slack_user_id: null };
    expect(authorizeAction({ action: "ack", delivery: channel, clickerSlackId: "U5", login: null }).ok).toBe(true);
    expect(authorizeAction({ action: "pto.approve", delivery: channel, clickerSlackId: "U5", login: login("staff") }).ok).toBe(false);
  });

  it("needs a login to complete a task", () => {
    expect(authorizeAction({ action: "task.complete", delivery: dm, clickerSlackId: "U123", login: null }).ok).toBe(false);
    expect(authorizeAction({ action: "task.complete", delivery: dm, clickerSlackId: "U123", login: login("staff") }).ok).toBe(true);
  });
});
