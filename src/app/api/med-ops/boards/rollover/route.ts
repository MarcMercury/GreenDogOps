import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily board rollover — archives yesterday's boards and builds today's from the
 * overnight ezyVet reports. Runs after the agent finishes its morning pull.
 * Idempotent, so the duplicate DST-safe cron hour is harmless.
 */
async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("medical_board_rollover", {
    p_today: null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Seeding only knows what ezyVet sends, which carries no attending doctor.
  // This resolves the doctor from the schedule and the CSR from the booking
  // notes; best-effort so a fill failure never loses the rebuilt board.
  const { data: staff, error: staffError } = await admin.rpc(
    "medical_board_fill_staff",
    { p_date: null },
  );

  return NextResponse.json({
    ...(data ?? { ok: true }),
    staff_fill: staffError ? { error: staffError.message } : staff,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
