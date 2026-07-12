import { NextResponse, type NextRequest } from "next/server";
import {
  verifyIndeedSignature,
  ingestIndeedApplication,
  type IndeedApplyPayload,
} from "@/lib/ats/indeed";

// Node.js runtime (crypto + service-role Supabase client); never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indeed Apply application webhook. Register this URL as the `postUrl` in each
 * job's `indeed-apply-data` metadata. Indeed POSTs one JSON application per
 * candidate here. We verify the `X-Indeed-Signature` header, then create a
 * recruiting candidate. Response codes follow Indeed's delivery contract:
 * 200 ok, 401 bad signature, 400 missing data, 409 duplicate, 422/500 failure.
 */
export async function POST(req: NextRequest) {
  const raw = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-indeed-signature");

  if (!verifyIndeedSignature(raw, signature)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing X-Indeed-Signature." },
      { status: 401 },
    );
  }

  let payload: IndeedApplyPayload;
  try {
    payload = JSON.parse(raw.toString("utf8")) as IndeedApplyPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON." }, { status: 400 });
  }

  const result = await ingestIndeedApplication(payload);
  return NextResponse.json(result.body, { status: result.status });
}
