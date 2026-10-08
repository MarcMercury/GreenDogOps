import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { completeGoogleConnection } from "@/lib/ats/google-calendar";
import { appBaseUrl } from "@/lib/ats/slack-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gdo_gcal_state";

/** Google redirects back here after the recruiter grants calendar access. */
export async function GET(req: NextRequest) {
  const back = new URL(`${appBaseUrl()}/ats/availability`);
  const fail = (reason: string) => {
    back.searchParams.set("google", "error");
    back.searchParams.set("reason", reason);
    return NextResponse.redirect(back);
  };

  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete({ name: STATE_COOKIE, path: "/api/ats/google" });

  const current = await getCurrentUser();
  if (!current || !canEditModule(current.appUser, "ats")) {
    return NextResponse.redirect(`${appBaseUrl()}/login`);
  }
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "Access was not granted." : params.get("error")!);
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code || stored !== `${state}.${current.authId}`) {
    return fail("The sign-in link expired. Try connecting again.");
  }

  const res = await completeGoogleConnection(current.authId, code);
  if (!res.ok) return fail(res.error);

  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: "update",
    entity: "app_user",
    entityId: current.authId,
    summary: `Connected Google Calendar${res.email ? ` (${res.email})` : ""} for interview scheduling`,
  });
  back.searchParams.set("google", "connected");
  return NextResponse.redirect(back);
}
