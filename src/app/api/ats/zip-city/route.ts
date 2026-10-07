import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { normalizeUsZip } from "@/lib/shared/zip";
import { lookupCityByZip } from "@/lib/shared/zip-lookup";

export const runtime = "nodejs";

/**
 * ZIP → "City, ST" for the ATS candidate forms, which auto-fill the City
 * field as soon as a 5-digit ZIP is typed. Signed-in users only.
 * GET /api/ats/zip-city?zip=91335 → { ok: true, city: "Reseda, CA" | null }
 */
export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const zip = normalizeUsZip(req.nextUrl.searchParams.get("zip"));
  if (!zip) {
    return NextResponse.json({ ok: false, error: "Enter a 5-digit US ZIP." }, { status: 400 });
  }

  const city = await lookupCityByZip(zip);
  return NextResponse.json(
    { ok: true, city },
    { headers: { "Cache-Control": "private, max-age=86400" } },
  );
}
