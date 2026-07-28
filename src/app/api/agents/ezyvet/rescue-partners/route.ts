import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/auth/session";
import { syncRescuePartnersFromEzyvet } from "@/lib/crm/rescue-partner-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** True when the request carries the Vercel Cron `Authorization: Bearer` secret. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // local dev with no secret configured
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Current hour (0–23) in America/Los_Angeles. */
function pacificHour(): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date()).find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(h, 10) % 24;
}

/**
 * Daily 7 AM Pacific reconciliation: assimilate ezyVet "Rescue Partners"
 * contacts into the Rescue/Shelter CRM (adds new rescues, fills blank fields on
 * existing ones). Runs after the 6 AM Pacific agent has refreshed contacts.
 *
 * Vercel Cron is UTC-only with no DST awareness, so we fire at BOTH 14:00 UTC
 * (7 AM PDT) and 15:00 UTC (7 AM PST) and only run when the local Pacific hour
 * is actually 07 — exactly one sync per day, year-round. `?force=1` bypasses the
 * gate for manual/testing runs. CRON_SECRET-gated.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && pacificHour() !== 7) {
    return NextResponse.json({ ok: true, skipped: true, reason: "not 7 AM Pacific" });
  }

  const result = await syncRescuePartnersFromEzyvet();

  await recordAudit({
    actorId: null,
    actorEmail: "system:cron",
    action: "rescue.ezyvet.sync",
    entity: "crm_organization",
    summary: `Daily ezyVet rescue-partner sync — ${result.created} created, ${result.updated} updated, ${result.matched} matched`,
    metadata: {
      contacts: result.contacts,
      matched: result.matched,
      updated: result.updated,
      created: result.created,
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
