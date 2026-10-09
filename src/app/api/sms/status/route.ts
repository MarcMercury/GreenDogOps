import { NextResponse, type NextRequest } from "next/server";
import { verifyTwilioRequest } from "@/lib/sms/webhook";
import { handleStatusCallback } from "@/lib/sms/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio delivery-status callback for texts Ops sent. */
export async function POST(req: NextRequest) {
  const verified = await verifyTwilioRequest(req);
  if (!verified.ok) return new NextResponse(null, { status: verified.status });
  await handleStatusCallback(verified.params, req.nextUrl.searchParams.get("m"));
  return new NextResponse(null, { status: 204 });
}
