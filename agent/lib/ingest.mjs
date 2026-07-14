// Worker → app communication: report run progress to /api/agents/ingest and
// POST scraped CSVs to the ezyVet data sinks. All calls are CRON_SECRET-gated.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const APP_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET ?? "";

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${SECRET}`, ...extra };
}

/** Post an incremental update to the agent_run (status/logs/counters/cost). */
export async function reportRun(update) {
  try {
    const res = await fetch(`${APP_URL}/api/agents/ingest`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      console.error(`[ingest] reportRun ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[ingest] reportRun error:", err?.message ?? err);
  }
}

/** Convenience: append a single log line to the run. */
export function logRun(runId, message, level = "info") {
  console.log(`[run] ${message}`);
  return reportRun({ runId, logs: [{ level, message }] });
}

/** Create an agent_run (scheduled trigger) and return its id. */
export async function ensureRun(agentKey, targetDate, trigger = "scheduled") {
  const res = await fetch(`${APP_URL}/api/agents/start`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ agentKey, targetDate, trigger }),
  });
  const json = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !json.ok) {
    throw new Error(`Failed to create run: ${json.error ?? res.status}`);
  }
  return json.runId;
}

/** Rebuild the ezyVet reporting matviews (dedicated step; retried). */
export async function refreshReporting(retries = 2) {
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${APP_URL}/api/agents/ezyvet/refresh`, {
        method: "POST",
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (res.ok && json.ok) return json;
      lastErr = json.error ?? `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err?.message ?? String(err);
    }
  }
  throw new Error(`Reporting refresh failed: ${lastErr}`);
}

/**
 * Upload a scraped CSV file to an ezyVet data-sink endpoint.
 * @param endpoint  e.g. "ezyvet/invoice-lines" or "ezyvet/contacts"
 * @returns the endpoint's JSON result (records ingested, etc.)
 */
export async function uploadCsv(endpoint, filePath, query = {}) {
  const text = readFileSync(filePath, "utf8");
  // gzip so large exports (e.g. the full Contacts list) stay under the
  // serverless request-body size limit. Send as octet-stream WITHOUT a
  // Content-Encoding header (which makes the platform auto-decompress and
  // corrupt the body); the endpoint inflates by sniffing the gzip magic bytes.
  const body = gzipSync(Buffer.from(text, "utf8"));
  const qs = new URLSearchParams(query).toString();
  const url = `${APP_URL}/api/agents/${endpoint}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/octet-stream" }),
    body,
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) {
    throw new Error(`Ingest ${endpoint} failed: ${json.error ?? res.status}`);
  }
  return json;
}
