/**
 * Google auth for scripts.
 *
 * Two identities are supported:
 *   1. USER  — OAuth refresh token for a real Google account (marc.h.mercury@
 *      gmail.com). Sees every file that account can open; no sharing needed.
 *   2. ROBOT — the calendar-sync service account. Only sees files explicitly
 *      shared with calendar-sync@greendogops-calendar.iam.gserviceaccount.com.
 *
 * getGoogleAuth() prefers the user token and falls back to the service account.
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENV_FILE = path.join(ROOT, ".env.local");

export const READ_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** Read `key` from process.env, falling back to .env.local. */
export function env(key) {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync(ENV_FILE)) return null;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    if (!line.startsWith(`${key}=`)) continue;
    let v = line.slice(key.length + 1).trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    return v || null;
  }
  return null;
}

/** Upsert `KEY=value` in .env.local (created 0600 if missing). */
export function writeEnvValue(key, value) {
  const line = `${key}=${value}`;
  let body = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  body = re.test(body)
    ? body.replace(re, line)
    : `${body.replace(/\n*$/, "\n")}${line}\n`;
  fs.writeFileSync(ENV_FILE, body, { mode: 0o600 });
}

export function getOAuthClient() {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    env("GOOGLE_OAUTH_REDIRECT_URI") || "http://localhost:8787/oauth2callback",
  );
}

/** Env key holding the refresh token for each connected account. */
export const TOKEN_SLOTS = {
  primary: "GOOGLE_OAUTH_REFRESH_TOKEN",
  alt: "GOOGLE_OAUTH_REFRESH_TOKEN_ALT",
};

/** OAuth2 client for one connected account, or null if that slot is empty. */
export function getUserAuth(slot = "primary") {
  const refreshToken = env(TOKEN_SLOTS[slot] ?? slot);
  if (!refreshToken) return null;
  const client = getOAuthClient();
  if (!client) return null;
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Every connected account. A refresh token only sees files ITS account owns or
 * was given, so callers that must reach everything have to try each in turn.
 */
export function getUserAuths() {
  return Object.keys(TOKEN_SLOTS)
    .map((slot) => ({ slot, auth: getUserAuth(slot) }))
    .filter((x) => x.auth);
}

/** JWT client acting as the calendar-sync service account. */
export function getServiceAuth(scopes = READ_SCOPES) {
  const raw = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  const creds = JSON.parse(raw);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes,
  });
}

/** Identities to try, most-privileged first. */
export function getGoogleAuths(scopes = READ_SCOPES) {
  const list = getUserAuths().map(({ slot, auth }) => ({ auth, mode: slot }));
  const service = getServiceAuth(scopes);
  if (service) list.push({ auth: service, mode: "service" });
  if (!list.length) {
    throw new Error(
      "No Google credentials. Run `node scripts/google_oauth_setup.mjs` to " +
        "connect your Google account, or set GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }
  return list;
}

/** @returns {{ auth: import("google-auth-library").OAuth2Client, mode: string }} */
export function getGoogleAuth(scopes = READ_SCOPES) {
  return getGoogleAuths(scopes)[0];
}

/** Pull a file id out of a Docs/Sheets/Drive URL (or pass an id through). */
export function parseFileId(input) {
  const m = String(input).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : String(input).trim();
}
