import { NextResponse, type NextRequest } from "next/server";
import { verifyTwilioRequest } from "@/lib/sms/webhook";
import { handleInboundSms } from "@/lib/sms/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio "A message comes in" webhook: replies and STOP/START keywords. */
export async function POST(req: NextRequest) {
  const verified = await verifyTwilioRequest(req);
  if (!verified.ok) return new NextResponse(null, { status: verified.status });
  await handleInboundSms(verified.params);
  // Empty TwiML: Ops never auto-replies (Twilio's opt-out handling covers STOP/HELP).
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { "Content-Type": "text/xml" },
  });
}
