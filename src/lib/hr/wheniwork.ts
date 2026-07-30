import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TimeOffKind } from "@/lib/hr/types";

// ---------------------------------------------------------------------------
// When I Work → HR time-off sync (email-based).
//
// When I Work has no self-serve API on our plan, so instead of calling their
// API we parse the notification emails it sends to marcm@greendogdental.com
// (mirrored into the greendogmarcm@gmail.com inbox). Every "… requested time
// off …" message from noreply@wheniwork.com is a NEW, still-pending request, so
// each parsed request lands in greendogops.person_time_off as status
// 'requested' (pending), matched to the employee by name.
//
// Idempotency has two layers so re-runs never duplicate and never clobber an
// approval made later inside the app:
//   1. Upsert on (source='wheniwork', external_id=<gmail message id>).
//   2. Processed messages get the "GD-WIW-Imported" Gmail label and are
//      excluded from the search query. Because a request is only ever written
//      while its message is still unlabeled, an in-app approval (status flipped
//      to 'approved') is never overwritten on a later poll.
//
// Auth: OAuth2 with a long-lived refresh token for the greendogmarcm@gmail.com
// inbox (a consumer @gmail.com box can't be read by a service account).
// Required env:
//   WHENIWORK_GMAIL_REFRESH_TOKEN — refresh token for greendogmarcm@gmail.com.
// Optional env (fall back to the shared ATS Gmail OAuth app):
//   WHENIWORK_GMAIL_CLIENT_ID     (falls back to GMAIL_CLIENT_ID)
//   WHENIWORK_GMAIL_CLIENT_SECRET (falls back to GMAIL_CLIENT_SECRET)
//   WHENIWORK_GMAIL_MAX           — max messages per run (default 50).
// ---------------------------------------------------------------------------

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const IMPORTED_LABEL = "GD-WIW-Imported";
// Only time-off notifications, unprocessed, from roughly the last six months.
const SEARCH_QUERY =
  'from:noreply@wheniwork.com "requested the following time off" ' +
  "newer_than:180d -label:GD-WIW-Imported";
const DEFAULT_MAX = 50;

export interface WhenIWorkSyncResult {
  ok: boolean;
  scanned: number;
  created: number;
  updated: number;
  /** Names we couldn't match to a person (left unlabeled to retry later). */
  unmatched: string[];
  skipped: number;
  errors: string[];
}

// --- Gmail client ----------------------------------------------------------

/** Build a Gmail client for the greendogmarcm@gmail.com inbox. */
function getGmailClient(): gmail_v1.Gmail {
  const clientId = process.env.WHENIWORK_GMAIL_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID;
  const clientSecret =
    process.env.WHENIWORK_GMAIL_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.WHENIWORK_GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "When I Work email sync is not configured. Set WHENIWORK_GMAIL_REFRESH_TOKEN " +
        "(and GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET or the WHENIWORK_GMAIL_* overrides) " +
        "in .env.local / Vercel.",
    );
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken, scope: GMAIL_SCOPE });
  return google.gmail({ version: "v1", auth });
}

/** Resolve (creating if needed) the label id stamped on processed mail. */
async function getImportedLabelId(gmail: gmail_v1.Gmail): Promise<string> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === IMPORTED_LABEL);
  if (existing?.id) return existing.id;
  const { data: created } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: IMPORTED_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.id) throw new Error(`Could not create the ${IMPORTED_LABEL} label.`);
  return created.id;
}

// --- Message decoding ------------------------------------------------------

function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const h = payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeText(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64").toString("utf-8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best plain-text body from a message payload (prefers text/plain). */
function bodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  let plain = "";
  let html = "";
  const visit = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    const mime = part.mimeType ?? "";
    if (mime === "text/plain") plain += decodeText(part.body?.data);
    else if (mime === "text/html") html += decodeText(part.body?.data);
    part.parts?.forEach(visit);
  };
  visit(payload);
  return plain.trim() || htmlToText(html);
}

// --- Parsing ---------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DATE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;

const pad = (n: number) => String(n).padStart(2, "0");

/** All full "Mon D, YYYY" dates in the text as sorted ISO strings. */
function extractDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (!month || !day || !year) continue;
    out.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  return out.sort();
}

/** Strip a leading honorific ("Dr.", "Mr", …) from a person name. */
function stripTitle(name: string): string {
  return name.replace(/^\s*(dr|doctor|mr|mrs|ms|miss)\.?\s+/i, "").trim();
}

/** The employee name a When I Work notice is about, from subject then body. */
function extractName(subject: string, body: string): string | null {
  const subj = subject.match(/^(.+?)\s+requested\s+time\s+off\s+for/i)?.[1];
  const bod = body.match(
    /^\s*(.+?)\s+has\s+requested\s+the\s+following\s+time\s+off/i,
  )?.[1];
  const cleaned = stripTitle((subj ?? bod ?? "").trim());
  return cleaned.length >= 2 ? cleaned : null;
}

/** Map the When I Work time-off category text to our kind enum. */
function extractKind(body: string): TimeOffKind {
  const t = body.toLowerCase();
  if (t.includes("vacation")) return "vacation";
  if (t.includes("unpaid") || t.includes("personal")) return "time_off";
  return "pto";
}

/** The employee's optional message/reason, trimmed of the boilerplate footer. */
function extractNote(body: string): string | null {
  const m = body.match(/message:\s*([\s\S]+)/i);
  if (!m) return null;
  // Cut at the first footer marker When I Work appends after the message.
  const note = m[1]
    .trim()
    .split(/\b(Times shown|View Request|Manage|Unsubscribe|When I Work|©|http)/i)[0]
    .trim();
  return note ? note.slice(0, 500) : null;
}

interface ParsedRequest {
  name: string;
  startDate: string;
  endDate: string;
  kind: TimeOffKind;
  note: string | null;
}

function parseMessage(subject: string, body: string): ParsedRequest | null {
  const name = extractName(subject, body);
  const dates = extractDates(body);
  if (!name || dates.length === 0) return null;
  return {
    name,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    kind: extractKind(body),
    note: extractNote(body),
  };
}

// --- Name matching ---------------------------------------------------------

function normalizeName(s: string): string {
  return stripTitle(s)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface PersonRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  grid_name: string | null;
}

/** Build a normalized-name → person id lookup (full name + first/last combo). */
function buildNameIndex(people: PersonRow[]): Map<string, string> {
  const idx = new Map<string, string>();
  const add = (name: string | null | undefined, id: string) => {
    if (!name) return;
    const key = normalizeName(name);
    if (key.length >= 3) idx.set(key, id);
  };
  for (const p of people) {
    add(p.full_name, p.id);
    add(p.grid_name, p.id);
    if (p.first_name || p.last_name) add(`${p.first_name ?? ""} ${p.last_name ?? ""}`, p.id);
  }
  return idx;
}

// --- Sync ------------------------------------------------------------------

/**
 * Parse When I Work time-off notification emails and upsert them into
 * person_time_off as pending requests, matched to employees by name. Unmatched
 * names are returned (not errored) and their messages are left unlabeled so a
 * later roster fix lets them be picked up on the next run.
 */
export async function syncWhenIWorkTimeOff(): Promise<WhenIWorkSyncResult> {
  const result: WhenIWorkSyncResult = {
    ok: true,
    scanned: 0,
    created: 0,
    updated: 0,
    unmatched: [],
    skipped: 0,
    errors: [],
  };

  const gmail = getGmailClient();
  const labelId = await getImportedLabelId(gmail);
  const max = Number(process.env.WHENIWORK_GMAIL_MAX) || DEFAULT_MAX;

  const { data: list } = await gmail.users.messages.list({
    userId: "me",
    q: SEARCH_QUERY,
    maxResults: max,
  });
  const messages = list.messages ?? [];
  result.scanned = messages.length;
  if (messages.length === 0) return result;

  // Load people once and build the name index.
  const db = createAdminClient();
  const { data: people, error: peopleErr } = await db
    .from("person")
    .select("id, first_name, last_name, full_name, grid_name");
  if (peopleErr) throw new Error(`Failed to load people: ${peopleErr.message}`);
  const nameIndex = buildNameIndex((people ?? []) as PersonRow[]);

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });
      const subject = header(full.payload, "Subject");
      const parsed = parseMessage(subject, bodyText(full.payload));
      if (!parsed) {
        result.skipped += 1;
        continue;
      }

      const personId = nameIndex.get(normalizeName(parsed.name));
      if (!personId) {
        // Leave unlabeled so it retries once the employee exists on the roster.
        result.unmatched.push(parsed.name);
        continue;
      }

      const { data: upserted, error } = await db
        .from("person_time_off")
        .upsert(
          {
            person_id: personId,
            kind: parsed.kind,
            status: "requested",
            start_date: parsed.startDate,
            end_date: parsed.endDate,
            note: parsed.note,
            source: "wheniwork",
            external_id: msg.id,
          },
          { onConflict: "source,external_id" },
        )
        .select("created_at, updated_at")
        .single();
      if (error) {
        result.errors.push(`message ${msg.id}: ${error.message}`);
        continue;
      }
      // created_at === updated_at on a fresh insert; the trigger bumps updated_at on update.
      if (upserted && upserted.created_at === upserted.updated_at) result.created += 1;
      else result.updated += 1;

      // Mark processed so it is never re-imported.
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: { addLabelIds: [labelId] },
      });
    } catch (err) {
      result.errors.push(
        `message ${msg.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
