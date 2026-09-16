import "server-only";
import { google } from "googleapis";

/**
 * googleapis bundles its own copy of google-auth-library, and the two copies'
 * classes are structurally incompatible (private fields). Deriving the type
 * from the `google.auth` namespace keeps it identical to what the API clients
 * actually accept.
 */
type GoogleAuthClient =
  | InstanceType<typeof google.auth.OAuth2>
  | InstanceType<typeof google.auth.JWT>;

/**
 * Server-side Google reader for the connected spreadsheets.
 *
 * Two identities, tried most-privileged first (mirrors scripts/lib/google-auth.mjs):
 *   1. USER  — an OAuth refresh token for a real account. Sees every file that
 *      account can open, so a workbook never has to be shared explicitly.
 *   2. ROBOT — the calendar-sync service account. Only sees files shared with
 *      calendar-sync@greendogops-calendar.iam.gserviceaccount.com.
 *
 * The student grid is only visible to the user identity, so the fallback order
 * matters: a run authenticated solely as the service account would 404 on it.
 */

const READ_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

/** Env key holding the refresh token for each connected account. */
const TOKEN_SLOTS: Record<string, string> = {
  primary: "GOOGLE_OAUTH_REFRESH_TOKEN",
  alt: "GOOGLE_OAUTH_REFRESH_TOKEN_ALT",
};

export interface GoogleIdentity {
  mode: string;
  auth: GoogleAuthClient;
}

function userAuth(slot: string): GoogleAuthClient | null {
  const refreshToken = process.env[TOKEN_SLOTS[slot]];
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function serviceAuth(): GoogleAuthClient | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const creds = JSON.parse(raw) as { client_email: string; private_key: string };
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: READ_SCOPES,
  });
}

function identities(): GoogleIdentity[] {
  const list: GoogleIdentity[] = [];
  for (const slot of Object.keys(TOKEN_SLOTS)) {
    const auth = userAuth(slot);
    if (auth) list.push({ mode: slot, auth });
  }
  const service = serviceAuth();
  if (service) list.push({ mode: "service", auth: service });
  if (!list.length) {
    throw new Error(
      "No Google credentials. Set GOOGLE_OAUTH_CLIENT_ID / _CLIENT_SECRET / " +
        "_REFRESH_TOKEN, or GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }
  return list;
}

/** Google reports "not shared with me" as 404 or 403 depending on the API. */
function isAccessError(err: unknown): boolean {
  const code = (err as { code?: number | string; status?: number })?.code;
  const status = (err as { status?: number })?.status;
  const n = Number(code ?? status);
  return n === 403 || n === 404;
}

/**
 * Run `fn` against each identity in turn, returning the first that can see the
 * file. Non-access errors (bad range, quota, network) fail immediately.
 */
async function withIdentity<T>(fn: (auth: GoogleAuthClient) => Promise<T>): Promise<{ value: T; mode: string }> {
  const list = identities();
  let lastError: unknown;
  for (const { auth, mode } of list) {
    try {
      return { value: await fn(auth), mode };
    } catch (err) {
      if (!isAccessError(err)) throw err;
      lastError = err;
    }
  }
  const tried = list.map((i) => i.mode).join(", ");
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`No connected Google identity can read this file (tried: ${tried}). ${detail}`);
}

/** A tab's cells as rows of strings; short rows are NOT padded. */
export type SheetGrid = string[][];

/** Read one tab (or A1 range) as formatted strings. */
export async function readSheetRange(
  spreadsheetId: string,
  range: string,
): Promise<SheetGrid> {
  const { value } = await withIdentity(async (auth) => {
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });
    return (res.data.values ?? []) as SheetGrid;
  });
  return value;
}

/** Tab titles in the workbook, in sheet order. */
export async function listSheetTabs(spreadsheetId: string): Promise<string[]> {
  const { value } = await withIdentity(async (auth) => {
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    return (res.data.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter(Boolean);
  });
  return value;
}

/**
 * Drive modifiedTime, used to skip a workbook nobody has touched since the last
 * successful run. Returns null when no identity can read Drive metadata, which
 * degrades to "always sync" rather than failing the run.
 */
export async function getSpreadsheetModifiedTime(
  spreadsheetId: string,
): Promise<string | null> {
  try {
    const { value } = await withIdentity(async (auth) => {
      const drive = google.drive({ version: "v3", auth });
      const res = await drive.files.get({
        fileId: spreadsheetId,
        fields: "modifiedTime",
        supportsAllDrives: true,
      });
      return res.data.modifiedTime ?? null;
    });
    return value;
  } catch {
    return null;
  }
}
