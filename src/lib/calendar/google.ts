import "server-only";
import { google, type calendar_v3 } from "googleapis";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

function loadCredentials(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service account key " +
        "JSON (single line) to .env.local / Vercel.",
    );
  }
  let creds: ServiceAccountCredentials;
  try {
    creds = JSON.parse(raw) as ServiceAccountCredentials;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email / private_key.",
    );
  }
  return creds;
}

/** Read-only Google Calendar client authenticated as the service account. */
export function getCalendarClient(): calendar_v3.Calendar {
  const creds = loadCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [CALENDAR_SCOPE],
  });
  return google.calendar({ version: "v3", auth });
}
