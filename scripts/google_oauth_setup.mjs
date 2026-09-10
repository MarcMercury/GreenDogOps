#!/usr/bin/env node
/**
 * One-time: connect this program to a real Google account so every script can
 * read whatever that account can read (no per-file sharing with the service
 * account).
 *
 * Prereqs — Google Cloud console, project `greendogops-calendar`:
 *   1. APIs & Services > Library: enable Google Docs API, Google Sheets API,
 *      Google Drive API.
 *   2. OAuth consent screen: External, add marc.h.mercury@gmail.com as a Test
 *      user. IMPORTANT: while the app is in "Testing", refresh tokens expire
 *      after 7 days. Click "Publish app" to make them permanent.
 *   3. Credentials > Create credentials > OAuth client ID > **Desktop app**.
 *      Put the id/secret in .env.local as GOOGLE_OAUTH_CLIENT_ID /
 *      GOOGLE_OAUTH_CLIENT_SECRET.
 *
 * Then:
 *   node scripts/google_oauth_setup.mjs             # primary account
 *   node scripts/google_oauth_setup.mjs --alt        # second account
 *   node scripts/google_oauth_setup.mjs --code XXX   # paste the code manually
 *
 * Run it once per Google account: a refresh token only sees files ITS account
 * owns or was given. The refresh token is written to .env.local (gitignored).
 * Mirror it to Vercel with `vercel env add GOOGLE_OAUTH_REFRESH_TOKEN`.
 */
import http from "node:http";
import {
  READ_SCOPES,
  TOKEN_SLOTS,
  env,
  getOAuthClient,
  writeEnvValue,
} from "./lib/google-auth.mjs";

const SLOT = process.argv.includes("--alt") ? "alt" : "primary";
const TOKEN_KEY = TOKEN_SLOTS[SLOT];
const PORT = Number(env("GOOGLE_OAUTH_PORT") || 8787);
const REDIRECT =
  env("GOOGLE_OAUTH_REDIRECT_URI") || `http://localhost:${PORT}/oauth2callback`;

const client = getOAuthClient();
if (!client) {
  console.error(
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local " +
      "first (see the header of this file).",
  );
  process.exit(1);
}

async function save(code) {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "Google returned no refresh_token. Revoke the app at " +
        "https://myaccount.google.com/permissions and run this again " +
        "(consent must be re-prompted to mint one).",
    );
    process.exit(1);
  }
  writeEnvValue(TOKEN_KEY, tokens.refresh_token);
  console.log(`\nSaved ${TOKEN_KEY} to .env.local.`);
  console.log("Verify with: node scripts/read_google_file.mjs <doc-or-sheet-url>");
}

const codeArg = process.argv.indexOf("--code");
if (codeArg !== -1) {
  await save(process.argv[codeArg + 1]);
  process.exit(0);
}

const url = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: READ_SCOPES,
  redirect_uri: REDIRECT,
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback.");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Google account connected. You can close this tab.");
  server.close();
  await save(code);
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT} (slot: ${SLOT} -> ${TOKEN_KEY})\n`);
  console.log("Open this URL, sign in as the Google account you want the");
  console.log("program to act as, and approve read-only access:\n");
  console.log(url);
  console.log(
    "\nIf the browser cannot reach localhost, copy the `code=` value from the",
  );
  console.log("failed redirect URL and run:");
  console.log("  node scripts/google_oauth_setup.mjs --code <code>");
});
