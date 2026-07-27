import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Needs the raw body + Node crypto; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Resend webhook receiver.
//
// Resend signs webhooks with Svix. We verify the signature over the RAW body
// (so it must be read as text before parsing), then log every event to
// greendogops.email_event, idempotent on the Svix message id.
//
// Required env: RESEND_WEBHOOK_SECRET (the `whsec_…` signing secret shown when
// the endpoint is created in Resend / returned by the webhooks API).
// ---------------------------------------------------------------------------

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    [k: string]: unknown;
  };
}

/** Verify a Svix-signed payload. Returns true when any signature matches. */
function verifySignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  // The secret is `whsec_<base64>`; the HMAC key is the decoded base64.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${svixId}.${svixTimestamp}.${body}`;
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header is space-delimited `v1,<sig> v1,<sig2>` — check each.
  for (const part of signatureHeader.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "RESEND_WEBHOOK_SECRET is not set." },
      { status: 500 },
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { ok: false, error: "Missing Svix signature headers." },
      { status: 400 },
    );
  }

  const body = await req.text();
  if (!verifySignature(secret, svixId, svixTimestamp, body, svixSignature)) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature." },
      { status: 401 },
    );
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON." }, { status: 400 });
  }

  const data = event.data ?? {};
  const to = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
  const reason =
    data.bounce?.message ?? data.bounce?.subType ?? data.bounce?.type ?? null;

  const admin = createAdminClient();
  // Idempotent on the Svix message id — retries upsert onto the same row.
  const { error } = await admin.from("email_event").upsert(
    {
      resend_event_id: svixId,
      event_type: event.type ?? "unknown",
      email_id: data.email_id ?? null,
      to_addrs: to,
      from_addr: data.from ?? null,
      subject: data.subject ?? null,
      reason,
      payload: event,
      occurred_at: event.created_at ?? null,
    },
    { onConflict: "resend_event_id" },
  );

  if (error) {
    // Return 500 so Resend retries rather than dropping the event.
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
