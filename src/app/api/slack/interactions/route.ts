import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { verifySlackSignature } from "@/lib/slack/signature";
import { parseInteraction } from "@/lib/notify/interaction-rules";
import { handleSlackAction } from "@/lib/notify/interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64_000;

/**
 * Slack app ▸ Interactivity request URL. Slack POSTs button clicks here
 * (form-encoded `payload`). Verified with SLACK_SIGNING_SECRET (fails closed
 * when unset). Slack needs a 200 within 3 s, so the work runs after the
 * response; the clicker gets an ephemeral confirmation via response_url.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  const check = verifySlackSignature({
    secret: process.env.SLACK_SIGNING_SECRET,
    rawBody: raw,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!check.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: unknown = null;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "null");
  } catch {
    return NextResponse.json({ ok: false, error: "Bad payload." }, { status: 400 });
  }
  const parsed = parseInteraction(payload);
  if (parsed && parsed.actionId !== "link") {
    after(() => handleSlackAction(parsed));
  }
  return new NextResponse(null, { status: 200 });
}
