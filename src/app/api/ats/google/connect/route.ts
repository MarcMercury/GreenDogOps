import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditModule } from "@/lib/auth/permissions";
import { googleAuthUrl, isGoogleCalendarConfigured } from "@/lib/ats/google-calendar";
import { appBaseUrl } from "@/lib/ats/slack-notify";
import { linkToken } from "@/lib/ats/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "gdo_gcal_state";

/** Start "Connect Google Calendar" for the signed-in recruiter. */
export async function GET() {
  const current = await getCurrentUser();
  const back = `${appBaseUrl()}/ats/availability`;
  if (!current || !canEditModule(current.appUser, "ats")) {
    return NextResponse.redirect(`${appBaseUrl()}/login`);
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(`${back}?google=not_configured`);
  }
  const state = linkToken(18);
  (await cookies()).set(STATE_COOKIE, `${state}.${current.authId}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/ats/google",
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthUrl(state, current.email));
}
