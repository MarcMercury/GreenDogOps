#!/usr/bin/env node
/**
 * Re-connect the ATS applicant intake to the careers inbox
 * (greendogcareers@gmail.com) and mint a fresh GMAIL_REFRESH_TOKEN.
 *
 * Run this when the cron logs `ats.gmail_ingest_error ... invalid_grant`:
 * Google rejected the stored refresh token (password change, revoked access,
 * rotated client secret, or a consent screen back in "Testing" mode).
 *
 * Prereqs — Google Cloud console, project "GDD Ops":
 *   1. APIs & Services > Library: enable the Gmail API.
 *   2. OAuth consent screen: External and PUBLISHED (in "Testing" the refresh
 *      token dies after 7 days and this breaks again next week).
 *   3. Credentials > OAuth client ID > **Desktop app**. Put the id/secret in
 *      .env.local as GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.
 *
 * Usage:
 *   node scripts/gmail_oauth_setup.mjs            # check current token, then re-consent
 *   node scripts/gmail_oauth_setup.mjs --verify   # only check the current token
 *   node scripts/gmail_oauth_setup.mjs --code XXX # paste the code manually
 *
 * Sign in as the CAREERS account, not your personal one. The new token is
 * written to .env.local (gitignored); mirror it to Vercel with a stdin
 * redirect — piping into `vercel env add` has stored empty values before:
 *   node -e 'process.stdout.write(require("fs").readFileSync(".env.local","utf8").match(/^GMAIL_REFRESH_TOKEN=(.*)$/m)[1])' > /tmp/gmail.tok
 *   for e in production preview development; do vercel env rm GMAIL_REFRESH_TOKEN $e -y; vercel env add GMAIL_REFRESH_TOKEN $e < /tmp/gmail.tok; done
 *   rm /tmp/gmail.tok
 */
import http from "node:http";
import { google } from "googleapis";
import { env, writeEnvValue } from "./lib/google-auth.mjs";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const TOKEN_KEY = "GMAIL_REFRESH_TOKEN";
const PORT = Number(env("GMAIL_OAUTH_PORT") || 8788);
const REDIRECT =
  env("GMAIL_OAUTH_REDIRECT_URI") || `http://localhost:${PORT}/oauth2callback`;

const clientId = env("GMAIL_CLIENT_ID");
const clientSecret = env("GMAIL_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error(
    "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local first " +
      "(see the header of this file).",
  );
  process.exit(1);
}

const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

/** Which inbox does a refresh token actually open? Returns null if it is dead. */
async function checkToken(refreshToken) {
  const probe = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
  probe.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: probe });
  const { data } = await gmail.users.getProfile({ userId: "me" });
  return data.emailAddress;
}

async function verify() {
  const existing = env(TOKEN_KEY);
  if (!existing) {
    console.log(`No ${TOKEN_KEY} in .env.local.`);
    return false;
  }
  try {
    const address = await checkToken(existing);
    console.log(`Current ${TOKEN_KEY} works — inbox: ${address}`);
    return true;
  } catch (err) {
    const reason = err?.response?.data?.error || err?.message || String(err);
    console.log(`Current ${TOKEN_KEY} is rejected by Google: ${reason}`);
    if (String(reason).includes("invalid_grant")) {
      console.log(
        "invalid_grant = the token was revoked (account password changed, " +
          "access removed at myaccount.google.com/permissions, client secret " +
          "rotated, or the consent screen is back in Testing mode).",
      );
    }
    return false;
  }
}

async function save(code) {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "Google returned no refresh_token. Remove this app at " +
        "https://myaccount.google.com/permissions and run again — consent " +
        "must be re-prompted to mint one.",
    );
    process.exit(1);
  }
  const address = await checkToken(tokens.refresh_token);
  writeEnvValue(TOKEN_KEY, tokens.refresh_token);
  console.log(`\nSaved ${TOKEN_KEY} to .env.local (inbox: ${address}).`);
  if (address && address.toLowerCase() !== "greendogcareers@gmail.com") {
    console.log(
      `WARNING: expected greendogcareers@gmail.com — the intake will now read ${address}.`,
    );
  }
  console.log("Now mirror it to Vercel (see the header of this file), then run:");
  console.log('  curl -H "Authorization: Bearer $CRON_SECRET" "$SITE_URL/api/ats/gmail"');
}

if (process.argv.includes("--verify")) {
  process.exit((await verify()) ? 0 : 1);
}

const codeArg = process.argv.indexOf("--code");
if (codeArg !== -1) {
  await save(process.argv[codeArg + 1]);
  process.exit(0);
}

await verify();

const url = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
  redirect_uri: REDIRECT,
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback.");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Careers inbox connected. You can close this tab.");
  server.close();
  await save(code);
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`\nListening on ${REDIRECT}`);
  console.log(
    `Add that exact URI to the OAuth client's "Authorized redirect URIs" if it is not a Desktop app client.\n`,
  );
  console.log("Open this URL, sign in as greendogcareers@gmail.com, and approve");
  console.log("Gmail access (read + modify, so processed mail can be labeled):\n");
  console.log(url);
  console.log(
    "\nIf the browser cannot reach localhost (dev container), copy the `code=`",
  );
  console.log("value from the failed redirect URL and run:");
  console.log("  node scripts/gmail_oauth_setup.mjs --code <code>");
});
