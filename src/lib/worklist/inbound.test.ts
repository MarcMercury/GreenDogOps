import { describe, expect, it } from "vitest";
import { inboundTaskRow, parseInboundTask } from "./inbound";

const valid = {
  external_id: "Wf123-run-9",
  assignee_slack_user_id: "U0ABC123",
  title: "Restock gloves in Venice",
  due_date: "2026-10-12",
  priority: "high",
  link: "https://green-dog-group.slack.com/archives/C0AAA/p1760000000000100",
};

describe("parseInboundTask", () => {
  it("accepts a Slack workflow payload and maps it to a Slack-target task", () => {
    const r = parseInboundTask(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(inboundTaskRow(r.task)).toMatchObject({
      source: "slack",
      external_ref: "Wf123-run-9",
      action_target: "slack",
      priority: "high",
      due_date: "2026-10-12",
    });
  });

  it("treats blank optional fields (as Slack sends them) as absent", () => {
    const r = parseInboundTask({ ...valid, due_date: "", priority: "", link: "", details: " " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(inboundTaskRow(r.task)).toMatchObject({ due_date: null, priority: "normal", href: null, action_target: "ops" });
  });

  it("requires an assignee and an idempotency id", () => {
    const { assignee_slack_user_id: _drop, ...noAssignee } = valid;
    void _drop;
    expect(parseInboundTask(noAssignee).ok).toBe(false);
    expect(parseInboundTask({ ...valid, external_id: "" }).ok).toBe(false);
    expect(parseInboundTask({ ...noAssignee, assignee_email: "Jane@Example.com" }).ok).toBe(true);
  });

  it("rejects unsafe links, bad dates and bad Slack ids", () => {
    expect(parseInboundTask({ ...valid, link: "https://evil.com" }).ok).toBe(false);
    expect(parseInboundTask({ ...valid, link: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseInboundTask({ ...valid, due_date: "2026-02-30" }).ok).toBe(false);
    expect(parseInboundTask({ ...valid, assignee_slack_user_id: "<@U0ABC>" }).ok).toBe(false);
    expect(parseInboundTask({ ...valid, title: "x".repeat(201) }).ok).toBe(false);
    expect(parseInboundTask(null).ok).toBe(false);
  });

  it("an app path link is an Ops-target task", () => {
    const r = parseInboundTask({ ...valid, link: "/schedule" });
    expect(r.ok && inboundTaskRow(r.task).action_target).toBe("ops");
  });
});
