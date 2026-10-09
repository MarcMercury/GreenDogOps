import { describe, expect, it } from "vitest";
import { buildDmText, dmGate, retryDecision, slackEscape, DM_MAX_ATTEMPTS } from "./rules";

describe("dmGate", () => {
  it("is closed by default", () => {
    expect(dmGate({}, "U1").send).toBe(false);
    expect(dmGate({ live: "false" }, "U1").send).toBe(false);
  });

  it("opens when live, or for allow-listed test users only", () => {
    expect(dmGate({ live: "true" }, "U1").send).toBe(true);
    expect(dmGate({ testIds: "U2, U1" }, "U1").send).toBe(true);
    expect(dmGate({ testIds: "U2" }, "U1").send).toBe(false);
  });
});

describe("retryDecision", () => {
  it("never retries a send that may have been delivered", () => {
    expect(retryDecision("timeout", 1).status).toBe("failed");
    expect(retryDecision("channel_not_found", 1).status).toBe("failed");
  });

  it("retries rate limits with backoff, honouring Retry-After, up to the cap", () => {
    expect(retryDecision("ratelimited", 1)).toEqual({ status: "pending", delayMs: 60_000 });
    expect(retryDecision("ratelimited", 2, 300)).toEqual({ status: "pending", delayMs: 300_000 });
    expect(retryDecision("ratelimited", DM_MAX_ATTEMPTS).status).toBe("failed");
  });
});

describe("buildDmText", () => {
  it("escapes user text and links internal paths through the app origin", () => {
    const text = buildDmText(
      { title: "Review <script> & co", body: "Due Friday", href: "/ats/1" },
      "https://greendogops.com",
    );
    expect(text).toBe(
      "*Review &lt;script&gt; &amp; co*\nDue Friday\n<https://greendogops.com/ats/1|Open in Green Dog Ops>",
    );
  });

  it("links Slack URLs directly", () => {
    expect(buildDmText({ title: "T", body: null, href: "https://x.slack.com/archives/C1" }, "https://a")).toBe(
      "*T*\n<https://x.slack.com/archives/C1|Open in Slack>",
    );
    expect(slackEscape("a<b")).toBe("a&lt;b");
  });
});
