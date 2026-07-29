import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TimeOffKind, TimeOffStatus } from "@/lib/hr/types";

// ---------------------------------------------------------------------------
// When I Work → HR time-off sync.
//
// Polls the When I Work API for employee time-off requests and mirrors them
// into greendogops.person_time_off, matched to people by email. When I Work is
// treated as the authoritative source for these rows, so each run upserts on
// (source, external_id) — a manager approving/denying a request in When I Work
// is reflected on the next poll. Rows entered by hand on the HR profile
// (source='manual', external_id=NULL) are never touched.
//
// Auth (When I Work token model): a private developer key (W-Key) plus the
// email/password of a When I Work admin user are exchanged for a bearer token,
// which is then used for all data requests. Tokens are valid for ~7 days; we
// log in fresh each run, which is well within the (generous) rate limits.
//   Docs: https://apidocs.wheniwork.com/external/index.html
//
// Required env:
//   WHENIWORK_API_KEY   — developer / W-Key issued by When I Work support.
//   WHENIWORK_EMAIL     — When I Work admin login (e.g. Marcm@greendogdental.com).
//   WHENIWORK_PASSWORD  — that admin's When I Work password.
// Optional env:
//   WHENIWORK_LOOKBACK_DAYS — how far back to pull requests (default 120).
// ---------------------------------------------------------------------------

const LOGIN_URL = "https://api.login.wheniwork.com/login";
const API_BASE = "https://api.wheniwork.com/2";
const DEFAULT_LOOKBACK_DAYS = 120;

export interface WhenIWorkSyncResult {
  ok: boolean;
  scanned: number;
  created: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: string[];
}

interface WiwConfig {
  apiKey: string;
  email: string;
  password: string;
  lookbackDays: number;
}

/** Read + validate the When I Work credentials from the environment. */
function readConfig(): WiwConfig {
  const apiKey = process.env.WHENIWORK_API_KEY;
  const email = process.env.WHENIWORK_EMAIL;
  const password = process.env.WHENIWORK_PASSWORD;
  if (!apiKey || !email || !password) {
    throw new Error(
      "When I Work sync is not configured. Set WHENIWORK_API_KEY, WHENIWORK_EMAIL, " +
        "and WHENIWORK_PASSWORD in .env.local / Vercel.",
    );
  }
  const lookbackDays = Number(process.env.WHENIWORK_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS;
  return { apiKey, email, password, lookbackDays };
}

/** Exchange the developer key + admin login for a bearer token. */
async function login(cfg: WiwConfig): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "W-Key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!res.ok) {
    throw new Error(`When I Work login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { login?: { token?: string } };
  const token = json.login?.token;
  if (!token) throw new Error("When I Work login returned no token.");
  return token;
}

/** Authenticated GET against the When I Work v2 API. */
async function apiGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`When I Work GET ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// --- When I Work value mapping ---------------------------------------------
// These mappings are documented from the When I Work API conventions. Verify
// them against the first live payload (the ingest logs the raw counts) and
// adjust here if a code maps differently — everything else keys off these two
// helpers, so the mapping lives in exactly one place.

/** When I Work request status code → our time_off_status enum. */
function mapStatus(code: unknown): TimeOffStatus {
  // When I Work: 0 = pending/unapproved, 1 = approved, 2 = denied.
  switch (Number(code)) {
    case 1:
      return "approved";
    case 2:
      return "denied";
    default:
      return "requested";
  }
}

/** When I Work request type → our time_off_kind enum. */
function mapKind(type: unknown): TimeOffKind {
  // When I Work distinguishes paid vs unpaid time off; we bucket everything as
  // "pto" by default. Refine here once the live `type` values are confirmed.
  const t = String(type ?? "").toLowerCase();
  if (t.includes("vacation")) return "vacation";
  if (t === "0" || t.includes("unpaid")) return "time_off";
  return "pto";
}

/** Normalize a When I Work timestamp (ISO string or unix seconds) to YYYY-MM-DD. */
function toISODate(value: unknown): string | null {
  if (value == null || value === "") return null;
  let date: Date;
  if (typeof value === "number") {
    date = new Date(value * 1000);
  } else {
    const asNum = Number(value);
    date = Number.isFinite(asNum) && String(value).trim() === String(asNum)
      ? new Date(asNum * 1000)
      : new Date(String(value));
  }
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

interface WiwUser {
  id: number;
  email?: string | null;
}

interface WiwRequest {
  id: number | string;
  user_id?: number;
  type?: unknown;
  status?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  notes?: string | null;
}

/**
 * Poll When I Work for time-off requests and upsert them into person_time_off.
 * Matched to people by email; unmatched When I Work users are counted and
 * skipped (not an error) so onboarding gaps surface without failing the run.
 */
export async function syncWhenIWorkTimeOff(): Promise<WhenIWorkSyncResult> {
  const result: WhenIWorkSyncResult = {
    ok: true,
    scanned: 0,
    created: 0,
    updated: 0,
    unmatched: 0,
    skipped: 0,
    errors: [],
  };

  const cfg = readConfig();
  const token = await login(cfg);

  // Build a When I Work user_id → email map.
  const usersResp = await apiGet<{ users?: WiwUser[] }>(token, "/users");
  const userEmailById = new Map<number, string>();
  for (const u of usersResp.users ?? []) {
    if (u.email) userEmailById.set(u.id, u.email.trim().toLowerCase());
  }

  // Match When I Work emails to our people.
  const db = createAdminClient();
  const { data: people, error: peopleErr } = await db
    .from("person")
    .select("id, email")
    .not("email", "is", null);
  if (peopleErr) throw new Error(`Failed to load people: ${peopleErr.message}`);
  const personIdByEmail = new Map<string, string>();
  for (const p of people ?? []) {
    if (p.email) personIdByEmail.set(p.email.trim().toLowerCase(), p.id);
  }

  // Pull recent time-off requests.
  const since = new Date();
  since.setDate(since.getDate() - cfg.lookbackDays);
  const sinceParam = since.toISOString().slice(0, 10);
  const reqResp = await apiGet<{ requests?: WiwRequest[] }>(
    token,
    `/requests?since=${sinceParam}`,
  );
  const requests = reqResp.requests ?? [];
  result.scanned = requests.length;

  for (const req of requests) {
    const email = req.user_id != null ? userEmailById.get(req.user_id) : undefined;
    const personId = email ? personIdByEmail.get(email) : undefined;
    if (!personId) {
      result.unmatched += 1;
      continue;
    }

    const startDate = toISODate(req.start_time);
    const endDate = toISODate(req.end_time) ?? startDate;
    if (!startDate || !endDate) {
      result.skipped += 1;
      continue;
    }

    const row = {
      person_id: personId,
      kind: mapKind(req.type),
      status: mapStatus(req.status),
      start_date: startDate,
      end_date: endDate,
      note: req.notes ?? null,
      source: "wheniwork",
      external_id: String(req.id),
    };

    const { data: upserted, error } = await db
      .from("person_time_off")
      .upsert(row, { onConflict: "source,external_id" })
      .select("created_at, updated_at")
      .single();
    if (error) {
      result.errors.push(`request ${req.id}: ${error.message}`);
      continue;
    }
    // created_at === updated_at on a fresh insert; the trigger bumps updated_at on update.
    if (upserted && upserted.created_at === upserted.updated_at) {
      result.created += 1;
    } else {
      result.updated += 1;
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
