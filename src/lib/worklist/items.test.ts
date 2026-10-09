import { describe, expect, it } from "vitest";
import type { AppUser } from "../auth/permissions";
import {
  bucketFor,
  canAssignTaskTo,
  canChangeTask,
  groupWorkItems,
  isSafeWorkLink,
  slackClientUrl,
  workSummary,
  type WorkItem,
} from "./items";

const TODAY = "2026-10-09";

function item(patch: Partial<WorkItem>): WorkItem {
  return {
    id: "x",
    kind: "task",
    title: "T",
    detail: null,
    module: null,
    href: null,
    target: "ops",
    due: null,
    priority: "normal",
    ...patch,
  };
}

function user(patch: Partial<AppUser> = {}): AppUser {
  return {
    id: "me",
    email: "me@example.com",
    full_name: null,
    title: null,
    role: "staff",
    is_active: true,
    module_access: {},
    notes: null,
    person_id: null,
    last_seen_at: null,
    created_at: "",
    updated_at: "",
    ...patch,
  };
}

describe("bucketFor", () => {
  it("splits by due date relative to today", () => {
    expect(bucketFor("2026-10-08", TODAY)).toBe("overdue");
    expect(bucketFor(TODAY, TODAY)).toBe("today");
    expect(bucketFor("2026-10-16", TODAY)).toBe("week");
    expect(bucketFor("2026-10-17", TODAY)).toBe("later");
    expect(bucketFor(null, TODAY)).toBe("anytime");
  });
});

describe("groupWorkItems", () => {
  it("orders buckets, sorts by priority then due, and drops duplicate ids", () => {
    const groups = groupWorkItems(
      [
        item({ id: "a", due: "2026-10-12", priority: "normal", title: "later normal" }),
        item({ id: "b", due: "2026-10-13", priority: "urgent", title: "later urgent" }),
        item({ id: "c", due: "2026-10-01", title: "old" }),
        item({ id: "c", due: TODAY, title: "duplicate" }),
        item({ id: "d", title: "whenever" }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "week", "anytime"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(groups[0].items[0].title).toBe("old");
  });

  it("summarises overdue and due-today counts", () => {
    expect(
      workSummary([item({ due: "2026-10-01" }), item({ due: TODAY }), item({ due: TODAY }), item({})], TODAY),
    ).toEqual({ total: 4, overdue: 1, dueToday: 2 });
  });
});

describe("isSafeWorkLink", () => {
  it("allows app paths and Slack URLs only", () => {
    expect(isSafeWorkLink("/ats/123")).toBe(true);
    expect(isSafeWorkLink("/")).toBe(true);
    expect(isSafeWorkLink(null)).toBe(true);
    expect(isSafeWorkLink("https://green-dog-group.slack.com/archives/C1/p1")).toBe(true);
    expect(isSafeWorkLink("https://app.slack.com/client/T1")).toBe(true);
    expect(isSafeWorkLink("//evil.com")).toBe(false);
    expect(isSafeWorkLink("/\\evil.com")).toBe(false);
    expect(isSafeWorkLink("javascript:alert(1)")).toBe(false);
    expect(isSafeWorkLink("https://evil.com/slack.com/")).toBe(false);
    expect(isSafeWorkLink("https://slack.com.evil.com/")).toBe(false);
    expect(isSafeWorkLink("http://slack.com/")).toBe(false);
  });
});

describe("slackClientUrl", () => {
  it("only builds links from well-formed ids", () => {
    expect(slackClientUrl("T0ABC", "D0XYZ")).toBe("https://app.slack.com/client/T0ABC/D0XYZ");
    expect(slackClientUrl("T0ABC", "../x")).toBe("https://app.slack.com/client/T0ABC");
    expect(slackClientUrl(null)).toBe("https://app.slack.com/client");
  });
});

describe("task permissions", () => {
  it("staff can only assign to themselves; editors can assign to anyone", () => {
    expect(canAssignTaskTo(user(), "me")).toBe(true);
    expect(canAssignTaskTo(user(), "someone")).toBe(false);
    expect(canAssignTaskTo(user({ role: "schedule_admin" }), "someone")).toBe(true);
    expect(canAssignTaskTo(user({ role: "manager", is_active: false }), "me")).toBe(false);
  });

  it("only the assignee or the assigner can change a task", () => {
    const task = { assignee_user_id: "me", created_by_user_id: "boss" };
    expect(canChangeTask(user(), task)).toBe(true);
    expect(canChangeTask(user({ id: "boss" }), task)).toBe(true);
    expect(canChangeTask(user({ id: "other", role: "owner" }), task)).toBe(false);
  });
});
