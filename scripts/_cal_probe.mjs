import { google } from "googleapis";
import fs from "node:fs";

// Load .env.local minimally (KEY=VALUE, ignore comments)
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
});
const cal = google.calendar({ version: "v3", auth });

const candidates = process.argv.slice(2);
console.log("SA:", creds.client_email);
for (const id of candidates) {
  try {
    const res = await cal.events.list({
      calendarId: id,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 5,
      timeMin: new Date(Date.now() - 30 * 864e5).toISOString(),
      timeMax: new Date(Date.now() + 60 * 864e5).toISOString(),
    });
    console.log(`\nOK  ${id}\n  summary: ${res.data.summary}\n  items: ${res.data.items?.length ?? 0}`);
    for (const e of res.data.items ?? []) {
      console.log(`   - ${e.start?.dateTime ?? e.start?.date}  ${e.summary}`);
    }
  } catch (err) {
    console.log(`\nERR ${id}\n  ${err.code ?? ""} ${err.message}`);
  }
}
