import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "./signature";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
const ts = "1700000000";
const sign = (b: string, t = ts, s = secret) =>
  "v0=" + crypto.createHmac("sha256", s).update(`v0:${t}:${b}`).digest("hex");

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    expect(verifySlackSignature({ secret, rawBody: body, timestamp: ts, signature: sign(body), nowSec: 1700000060 }).ok).toBe(true);
  });

  it("fails closed without a secret or headers", () => {
    expect(verifySlackSignature({ secret: undefined, rawBody: body, timestamp: ts, signature: sign(body), nowSec: 1700000000 }).ok).toBe(false);
    expect(verifySlackSignature({ secret, rawBody: body, timestamp: null, signature: sign(body), nowSec: 1700000000 }).ok).toBe(false);
  });

  it("rejects tampered bodies, wrong secrets and replays", () => {
    expect(verifySlackSignature({ secret, rawBody: body + "x", timestamp: ts, signature: sign(body), nowSec: 1700000000 }).ok).toBe(false);
    expect(
      verifySlackSignature({ secret, rawBody: body, timestamp: ts, signature: sign(body, ts, "other"), nowSec: 1700000000 }).ok,
    ).toBe(false);
    expect(verifySlackSignature({ secret, rawBody: body, timestamp: ts, signature: sign(body), nowSec: 1700000000 + 301 }).ok).toBe(false);
  });
});
