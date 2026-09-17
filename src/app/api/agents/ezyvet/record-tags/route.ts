import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest as authorized } from "@/lib/auth/cron";
import { readCsvBody } from "@/lib/agents/http";
import { ingestRecordTagCsv, listRecordTagsToRun } from "@/lib/reporting/record-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The tag worklist for a run. The app owns which tags exist so the worker stays
 * a dumb executor and the list can change without redeploying it.
 *
 * Query: mode (backfill | incremental). A backfill returns every active tag; an
 * incremental run returns only tags that have already been backfilled, because
 * a windowed pull on a tag with no baseline would record a handful of recently
 * touched records as if they were the whole population.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const mode = req.nextUrl.searchParams.get("mode") ?? "incremental";
  if (mode !== "backfill" && mode !== "incremental") {
    return NextResponse.json({ ok: false, error: `unknown mode "${mode}"` }, { status: 400 });
  }
  return NextResponse.json(await listRecordTagsToRun(mode));
}

/**
 * Agent data sink: accepts the CSV exported from Dashboard ▸ Records filtered
 * to one ezyVet tag, and merges it into that tag's membership. Called by
 * agent/record-tags.mjs. CRON_SECRET-gated.
 *
 * Query: tag_key (our slug), tag_label (the ezyVet tag), mode
 *        (backfill | incremental), activity_from (required when incremental),
 *        record_type (contact | animal), tag_type, tag_group, run_on.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const tagKey = q.get("tag_key");
  const tagLabel = q.get("tag_label");
  if (!tagKey || !tagLabel) {
    return NextResponse.json({ ok: false, error: "tag_key and tag_label are required" }, { status: 400 });
  }
  const mode = q.get("mode") ?? "incremental";
  if (mode !== "backfill" && mode !== "incremental") {
    return NextResponse.json({ ok: false, error: `unknown mode "${mode}"` }, { status: 400 });
  }
  const recordType = q.get("record_type") ?? "contact";
  if (recordType !== "contact" && recordType !== "animal") {
    return NextResponse.json({ ok: false, error: `unknown record_type "${recordType}"` }, { status: 400 });
  }

  const text = await readCsvBody(req);
  if (!text || text.length < 10) {
    return NextResponse.json({ ok: false, error: "empty CSV body" }, { status: 400 });
  }

  const result = await ingestRecordTagCsv(text, {
    tagKey,
    tagLabel,
    tagType: q.get("tag_type") ?? "pet_tag",
    tagGroup: q.get("tag_group"),
    recordType,
    mode,
    activityFrom: q.get("activity_from"),
    runOn: q.get("run_on"),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
