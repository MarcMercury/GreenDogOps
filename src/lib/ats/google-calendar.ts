import "server-only";
import { calendar as calendarApi, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "./slack-notify";
import type { Interval } from "./scheduling";

// ---------------------------------------------------------------------------
// Per-recruiter Google Calendar connection for interview self-scheduling.
//
// Each interviewer connects their own Google account once (most of the team
// uses personal Gmail, so a Workspace-wide service account can't see them).
// Ops only asks Google for free/busy and creates the interview event; it never
// imports the calendar. Refresh tokens live in recruiter_google_token, which
// only the service role can read.
//
// Env: GOOGLE_CALENDAR_OAUTH_CLIENT_ID / _SECRET (a "Web application" OAuth
// client with <APP_BASE_URL>/api/ats/google/callback as a redirect URI),
// falling back to GOOGLE_OAUTH_CLIENT_ID / _SECRET.
// ---------------------------------------------------------------------------

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

function clientCredentials(): { id: string; secret: string } | null {
  const id = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret =
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export function isGoogleCalendarConfigured(): boolean {
  return clientCredentials() !== null;
}

export function googleRedirectUri(): string {
  return `${appBaseUrl()}/api/ats/google/callback`;
}

function oauthClient(): OAuth2Client {
  const creds = clientCredentials();
  if (!creds) throw new Error("Google Calendar sign-in is not configured.");
  return new OAuth2Client({
    clientId: creds.id,
    clientSecret: creds.secret,
    redirectUri: googleRedirectUri(),
  });
}

export function googleAuthUrl(state: string, loginHint?: string | null): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

/** Exchange the callback code and store the refresh token for this user. */
export async function completeGoogleConnection(
  userId: string,
  code: string,
): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const client = oauthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (err) {
    return { ok: false, error: `Google sign-in failed: ${(err as Error).message}` };
  }
  if (!tokens.refresh_token) {
    return {
      ok: false,
      error: "Google didn't return offline access. Remove Green Dog Ops from your Google account's third-party access and connect again.",
    };
  }
  const granted = (tokens.scope ?? "").split(/\s+/);
  const needed = GOOGLE_CALENDAR_SCOPES.filter((sc) => sc.startsWith("https://"));
  if (!needed.every((sc) => granted.includes(sc))) {
    return { ok: false, error: "Calendar access wasn't granted. Connect again and tick the calendar permissions." };
  }

  let email: string | null = null;
  if (tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token });
      email = ticket.getPayload()?.email ?? null;
    } catch {
      // The email is only a label; the token itself is what matters.
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.from("recruiter_google_token").upsert(
    {
      user_id: userId,
      google_email: email,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };
  await admin.from("recruiter_schedule").upsert(
    { user_id: userId, google_email: email, google_connected_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return { ok: true, email };
}

/** Forget (and revoke, best-effort) a user's Google connection. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("recruiter_google_token")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  const token = (data as { refresh_token?: string } | null)?.refresh_token;
  if (token && isGoogleCalendarConfigured()) {
    try {
      await oauthClient().revokeToken(token);
    } catch {
      // Already revoked on Google's side.
    }
  }
  await admin.from("recruiter_google_token").delete().eq("user_id", userId);
  await admin
    .from("recruiter_schedule")
    .update({ google_email: null, google_connected_at: null })
    .eq("user_id", userId);
}

async function calendarFor(userId: string): Promise<calendar_v3.Calendar | null> {
  if (!isGoogleCalendarConfigured()) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("recruiter_google_token")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  const token = (data as { refresh_token?: string } | null)?.refresh_token;
  if (!token) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: token });
  return calendarApi({ version: "v3", auth });
}

export type BusyResult =
  | { connected: false; busy: Interval[] }
  | { connected: true; busy: Interval[]; error?: string };

/**
 * Busy blocks on the user's primary Google calendar. Errors are reported, not
 * thrown, so the caller can decide whether to offer times without them.
 */
export async function googleBusy(userId: string, from: Date, to: Date): Promise<BusyResult> {
  const cal = await calendarFor(userId);
  if (!cal) return { connected: false, busy: [] };
  try {
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: "primary" }],
      },
    });
    const primary = res.data.calendars?.primary;
    if (primary?.errors?.length) {
      return { connected: true, busy: [], error: primary.errors.map((e) => e.reason).join(", ") };
    }
    const busy = (primary?.busy ?? [])
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
    return { connected: true, busy };
  } catch (err) {
    return { connected: true, busy: [], error: (err as Error).message };
  }
}

/**
 * Put the interview on the interviewer's Google calendar with the candidate as
 * a guest; Google emails the candidate the invite. Returns the event id, or
 * null when the user isn't connected or Google refused.
 */
export async function createGoogleInterviewEvent(
  userId: string,
  e: {
    summary: string;
    description: string;
    location: string | null;
    start: Date;
    end: Date;
    timeZone: string;
    attendeeEmail: string | null;
    attendeeName: string | null;
  },
): Promise<{ eventId: string | null; error?: string }> {
  const cal = await calendarFor(userId);
  if (!cal) return { eventId: null };
  try {
    const res = await cal.events.insert({
      calendarId: "primary",
      sendUpdates: e.attendeeEmail ? "all" : "none",
      requestBody: {
        summary: e.summary,
        description: e.description,
        location: e.location ?? undefined,
        start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
        end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
        attendees: e.attendeeEmail
          ? [{ email: e.attendeeEmail, displayName: e.attendeeName ?? undefined }]
          : undefined,
        reminders: { useDefault: true },
      },
    });
    return { eventId: res.data.id ?? null };
  } catch (err) {
    return { eventId: null, error: (err as Error).message };
  }
}

/** Move an interview event to a new time; Google emails the candidate the update. */
export async function moveGoogleEvent(
  userId: string,
  eventId: string,
  start: Date,
  end: Date,
  timeZone: string,
): Promise<boolean> {
  const cal = await calendarFor(userId);
  if (!cal) return false;
  try {
    await cal.events.patch({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
      requestBody: {
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
      },
    });
    return true;
  } catch (err) {
    console.error("[ats] Google event move failed:", (err as Error).message);
    return false;
  }
}

export async function deleteGoogleEvent(userId: string, eventId: string): Promise<void> {
  const cal = await calendarFor(userId);
  if (!cal) return;
  try {
    await cal.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
  } catch {
    // Already gone.
  }
}
