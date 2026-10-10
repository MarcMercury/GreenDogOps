import { describe, expect, it } from "vitest";
import { agentHealth, classifyAgentError, cronRecordMode, needsAttention, type HealthAgent } from "./health";

const NOW = new Date("2026-10-10T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

function agent(over: Partial<HealthAgent> = {}): HealthAgent {
  return {
    enabled: true,
    config: { stale_after_minutes: 60 },
    last_run_at: minsAgo(5),
    last_status: "success",
    last_success_at: minsAgo(5),
    last_error: null,
    consecutive_failures: 0,
    ...over,
  };
}

describe("classifyAgentError", () => {
  it.each([
    ["invalid_grant", "credentials"],
    ["Slack auth failed: invalid_auth", "credentials"],
    ["Not Found", "access"],
    ["missing_scope", "access"],
    ["Slack isn't configured (SLACK_BOT_TOKEN is not set).", "config"],
    ['Pet tag "ap" did not resolve to a tag id', "config"],
    ['No freshly generated CSV appeared in the Report Queue for "Estimate Status" within 180s.', "timeout"],
    ["ratelimited", "rate_limit"],
    ["fetch failed", "network"],
    ["Ingest ezyvet/referral failed: Empty", "data"],
  ])("%s → %s", (error, category) => {
    expect(classifyAgentError(error)).toBe(category);
  });

  it("returns null without an error", () => {
    expect(classifyAgentError(null)).toBeNull();
    expect(classifyAgentError("  ")).toBeNull();
  });
});

describe("agentHealth", () => {
  it("is healthy after a recent clean success", () => {
    expect(agentHealth(agent(), null, NOW).state).toBe("ok");
  });

  it("flags a success that carried an error as partial", () => {
    const h = agentHealth(agent({ last_error: "1 of 4 tags failed" }), null, NOW);
    expect(h.state).toBe("warning");
    expect(h.summary).toContain("1 of 4 tags failed");
  });

  it("is failing after any failure since the last success, with the error", () => {
    const h = agentHealth(
      agent({ last_status: "error", consecutive_failures: 3, last_error: "Not Found", last_success_at: minsAgo(30) }),
      null,
      NOW,
    );
    expect(h.state).toBe("failing");
    expect(h.category).toBe("access");
    expect(h.summary).toBe("Failed 3 runs in a row: Not Found");
  });

  it("is stale when the last success is older than the job's threshold", () => {
    const h = agentHealth(agent({ last_run_at: minsAgo(200), last_success_at: minsAgo(200) }), null, NOW);
    expect(h.state).toBe("stale");
    expect(h.summary).toBe("No success for 3h (expected within 1h).");
  });

  it("is stale when it has run but never succeeded", () => {
    expect(agentHealth(agent({ last_success_at: null }), null, NOW).state).toBe("stale");
  });

  it("does not judge staleness without a threshold", () => {
    expect(agentHealth(agent({ config: {}, last_success_at: minsAgo(99999) }), null, NOW).state).toBe("ok");
  });

  it("reports a run that never finished as stuck", () => {
    const h = agentHealth(agent(), { status: "running", started_at: minsAgo(120), created_at: minsAgo(120) }, NOW);
    expect(h.state).toBe("stuck");
  });

  it("does not call a run in progress stuck", () => {
    expect(agentHealth(agent(), { status: "running", started_at: minsAgo(10), created_at: minsAgo(10) }, NOW).state).toBe("ok");
  });

  it("separates never-run and disabled jobs", () => {
    expect(agentHealth(agent({ last_run_at: null, last_success_at: null }), null, NOW).state).toBe("never_run");
    expect(agentHealth(agent({ enabled: false, consecutive_failures: 5 }), null, NOW).state).toBe("disabled");
  });
});

describe("needsAttention", () => {
  const check = (a: HealthAgent) => needsAttention(a, agentHealth(a, null, NOW));

  it("ignores a single failure of a frequent job", () => {
    expect(check(agent({ last_status: "error", consecutive_failures: 1, last_error: "fetch failed" }))).toBe(false);
  });

  it("raises repeated failures of a frequent job", () => {
    expect(check(agent({ last_status: "error", consecutive_failures: 2, last_error: "fetch failed" }))).toBe(true);
  });

  it("raises the first failure of a daily job", () => {
    expect(
      check(agent({ config: { stale_after_minutes: 1560 }, last_status: "error", consecutive_failures: 1, last_error: "x" })),
    ).toBe(true);
  });

  it("raises stale jobs but not partial successes or never-run jobs", () => {
    expect(check(agent({ last_success_at: minsAgo(500) }))).toBe(true);
    expect(check(agent({ last_error: "1 of 4 tags failed" }))).toBe(false);
    expect(check(agent({ last_run_at: null, last_success_at: null }))).toBe(false);
  });
});

describe("cronRecordMode", () => {
  it("only stamps the agent for a quiet success", () => {
    expect(cronRecordMode({ error: null, changed: 0, lastError: null })).toBe("stamp");
  });

  it("records runs that changed something", () => {
    expect(cronRecordMode({ error: null, changed: 3, lastError: null })).toBe("run");
  });

  it("records a new error but only counts a repeat of the same one", () => {
    expect(cronRecordMode({ error: "Not Found", changed: 0, lastError: null })).toBe("run");
    expect(cronRecordMode({ error: "Not Found", changed: 0, lastError: "Not Found" })).toBe("stamp");
    expect(cronRecordMode({ error: "invalid_grant", changed: 0, lastError: "Not Found" })).toBe("run");
  });

  it("records every run of a daily or weekly job", () => {
    expect(cronRecordMode({ error: null, changed: 0, everyRun: true, lastError: null })).toBe("run");
    expect(cronRecordMode({ error: "x", changed: 0, everyRun: true, lastError: "x" })).toBe("run");
  });
});
