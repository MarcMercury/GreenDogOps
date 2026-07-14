import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Create an agent_run row and return its id. Used by the worker for SCHEDULED
 * runs (GitHub cron), which don't originate from the app's "Run now" button.
 * CRON_SECRET-gated. Body: { agentKey, targetDate?, trigger? }.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { agentKey?: string; targetDate?: string; trigger?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!body.agentKey) {
    return NextResponse.json({ ok: false, error: "agentKey required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: agent, error: agentErr } = await admin
    .from("agent")
    .select("id")
    .eq("key", body.agentKey)
    .single();
  if (agentErr || !agent) {
    return NextResponse.json({ ok: false, error: "agent not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: run, error: runErr } = await admin
    .from("agent_run")
    .insert({
      agent_id: agent.id,
      trigger: body.trigger === "manual" ? "manual" : "scheduled",
      status: "running",
      target_date: body.targetDate ?? null,
      started_at: nowIso,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return NextResponse.json({ ok: false, error: runErr?.message ?? "insert failed" }, { status: 500 });
  }

  await admin.from("agent").update({ last_run_at: nowIso, last_status: "running" }).eq("id", agent.id);
  return NextResponse.json({ ok: true, runId: run.id as string });
}
