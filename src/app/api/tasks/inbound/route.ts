import { NextResponse, type NextRequest } from "next/server";
import { hasBearerSecret } from "@/lib/auth/cron";
import { parseInboundTask } from "@/lib/worklist/inbound";
import { createInboundTask } from "@/lib/worklist/tasks";
import { appBaseUrl } from "@/lib/shared/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_384;

/**
 * Slack workflow → Ops task. POST JSON (see src/lib/worklist/inbound.ts) with
 * `Authorization: Bearer <OPS_INBOUND_TASK_SECRET>`. Idempotent on
 * `external_id`: a repeat returns 200 with the existing task id.
 *
 *   201 { ok, id, url }            created
 *   200 { ok, id, url, duplicate } already created for this external_id
 *   400 bad JSON / payload, 401 bad secret, 413 too large, 422 unknown assignee
 */
export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.OPS_INBOUND_TASK_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseInboundTask(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const result = await createInboundTask(parsed.task);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json(
    { ok: true, id: result.id, url: `${appBaseUrl()}/`, duplicate: result.duplicate },
    { status: result.duplicate ? 200 : 201 },
  );
}
