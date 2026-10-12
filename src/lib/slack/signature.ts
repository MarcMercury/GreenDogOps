// Verify that a request really came from Slack (signing secret v0 scheme).
// https://api.slack.com/authentication/verifying-requests-from-slack
// Pure (node:crypto only) so it can be unit-tested.

import crypto from "node:crypto";

/** Requests older than this are rejected (replay protection). */
export const SLACK_SIGNATURE_MAX_AGE_SEC = 5 * 60;

export type SlackSignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySlackSignature(input: {
  secret: string | undefined;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowSec?: number;
}): SlackSignatureCheck {
  if (!input.secret) return { ok: false, reason: "SLACK_SIGNING_SECRET is not set." };
  if (!input.timestamp || !input.signature) return { ok: false, reason: "Missing Slack signature headers." };
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "Bad timestamp." };
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SLACK_SIGNATURE_MAX_AGE_SEC) return { ok: false, reason: "Stale request." };

  const expected =
    "v0=" + crypto.createHmac("sha256", input.secret).update(`v0:${input.timestamp}:${input.rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "Signature mismatch." };
  return { ok: true };
}
