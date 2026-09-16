import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSpreadsheetModifiedTime } from "@/lib/google/sheets";
import { emptyResult, todayLA, type SheetSyncResult, type SyncIssue } from "./common";
import { syncHrRoster } from "./hr-roster";
import { readSchedulePlacements, applySchedulePlacements } from "./schedule";
import { syncStudentGrid } from "./students";

/**
 * Orchestrates the nightly spreadsheet pull.
 *
 * Every source is read through the same shape: check Drive's modifiedTime, skip
 * the workbook when nobody has touched it since the last successful run, apply
 * the safe changes, then reconcile the review queue so a problem that has been
 * fixed in the sheet closes itself.
 *
 * The whole run is recorded as an `agent_run` of the `sheet_daily_sync` agent,
 * so it shows up in Admin ▸ Agents with the same history and drill-down as the
 * ezyVet ingest.
 */

export const SHEET_AGENT_KEY = "sheet_daily_sync";

export interface SheetSourceRow {
  id: string;
  key: string;
  name: string;
  spreadsheet_id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_modified_time: string | null;
}

export interface SourceOutcome {
  status: "success" | "error" | "skipped";
  parsed: number;
  inserted: number;
  updated: number;
  issues: number;
  ms: number;
  error?: string;
  notes?: Record<string, unknown>;
}

export interface SheetSyncRunResult {
  ok: boolean;
  runId: string | null;
  sources: Record<string, SourceOutcome>;
}

export interface RunOptions {
  /** Only sync these source keys (defaults to every enabled source). */
  only?: string[];
  /** Sync even when Drive says the workbook has not changed. */
  force?: boolean;
  trigger?: "scheduled" | "manual";
  triggeredBy?: string | null;
  triggeredByEmail?: string | null;
}

/**
 * Upsert the issues this run found and close the ones it did not.
 * Anything a human already marked `ignored` stays ignored.
 */
async function reconcileIssues(
  sourceKey: string,
  runId: string | null,
  issues: SyncIssue[],
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // An item a human marked "ignored" is a permanent exception (the 1099s who
  // will never appear on the HR comp sheet). Refresh what we know about it, but
  // never re-open it.
  const { data: existing } = await admin
    .from("sheet_sync_issue")
    .select("kind, subject, status")
    .eq("source_key", sourceKey);
  const ignored = new Set(
    ((existing ?? []) as { kind: string; subject: string; status: string }[])
      .filter((row) => row.status === "ignored")
      .map((row) => `${row.kind}\u0000${row.subject}`),
  );

  if (issues.length) {
    const { error } = await admin.from("sheet_sync_issue").upsert(
      issues.map((i) => {
        const isIgnored = ignored.has(`${i.kind}\u0000${i.subject}`);
        return {
          source_key: sourceKey,
          run_id: runId,
          kind: i.kind,
          subject: i.subject,
          detail: i.detail,
          status: isIgnored ? "ignored" : "open",
          last_seen_at: now,
          ...(isIgnored ? {} : { resolved_at: null, resolved_by_email: null }),
        };
      }),
      { onConflict: "source_key,kind,subject" },
    );
    if (error) throw new Error(`record issues: ${error.message}`);
  }

  // Anything still open that this run did not re-report has been fixed.
  const seen = new Set(issues.map((i) => `${i.kind}\u0000${i.subject}`));
  const { data: open } = await admin
    .from("sheet_sync_issue")
    .select("id, kind, subject")
    .eq("source_key", sourceKey)
    .eq("status", "open");
  const stale = ((open ?? []) as { id: string; kind: string; subject: string }[])
    .filter((row) => !seen.has(`${row.kind}\u0000${row.subject}`))
    .map((row) => row.id);
  if (stale.length) {
    await admin
      .from("sheet_sync_issue")
      .update({ status: "resolved", resolved_at: now, resolved_by_email: "system:sheet_sync" })
      .in("id", stale);
  }
}

async function log(runId: string | null, level: string, message: string, data: Record<string, unknown> = {}) {
  if (!runId) return;
  const admin = createAdminClient();
  await admin.from("agent_run_log").insert({ run_id: runId, level, message, data });
}

/** Run one source. Reading the schedule up front lets the HR sync see the
 *  name spellings the schedule depends on before it rewrites any grid_name. */
async function runSource(
  source: SheetSourceRow,
  runId: string | null,
  force: boolean,
): Promise<SourceOutcome> {
  const startedAt = Date.now();
  const admin = createAdminClient();

  const modifiedTime = await getSpreadsheetModifiedTime(source.spreadsheet_id);
  const unchanged =
    !force &&
    modifiedTime !== null &&
    source.last_modified_time !== null &&
    new Date(modifiedTime).getTime() === new Date(source.last_modified_time).getTime();

  if (unchanged) {
    await admin
      .from("sheet_sync_source")
      .update({ last_synced_at: new Date().toISOString(), last_status: "skipped", last_error: null })
      .eq("id", source.id);
    await log(runId, "info", `${source.name}: unchanged since the last run — skipped.`);
    return { status: "skipped", parsed: 0, inserted: 0, updated: 0, issues: 0, ms: Date.now() - startedAt };
  }

  let result: SheetSyncResult = emptyResult();
  try {
    switch (source.key) {
      case "hr_roster": {
        // Pull the schedule's name spellings first so a grid_name that the
        // schedule relies on is never replaced by a different HR spelling.
        let scheduleNames = new Set<string>();
        try {
          const scheduleSource = await loadSource("staff_schedule");
          if (scheduleSource) {
            const { placements } = await readSchedulePlacements(
              scheduleSource.spreadsheet_id,
              Number(scheduleSource.config.months_ahead ?? 1),
            );
            const { nameKey } = await import("./common");
            scheduleNames = new Set(placements.map((p) => nameKey(p.person)));
          }
        } catch {
          // The schedule being unreadable must not block the HR sync; the guard
          // simply falls back to "no known schedule spellings".
        }
        result = await syncHrRoster(source.spreadsheet_id, {
          currentTab: source.config.current_tab as string | undefined,
          formerTab: source.config.former_tab as string | undefined,
          scheduleNames,
        });
        break;
      }
      case "staff_schedule": {
        const { placements, tabs } = await readSchedulePlacements(
          source.spreadsheet_id,
          Number(source.config.months_ahead ?? 1),
        );
        result = await applySchedulePlacements(placements, tabs);
        break;
      }
      case "student_grid": {
        result = await syncStudentGrid(
          source.spreadsheet_id,
          source.config.year_tabs as string[] | undefined,
        );
        break;
      }
      default:
        throw new Error(`No sync is implemented for source "${source.key}".`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("sheet_sync_source")
      .update({ last_synced_at: new Date().toISOString(), last_status: "error", last_error: message })
      .eq("id", source.id);
    await log(runId, "error", `${source.name}: ${message}`);
    return { status: "error", parsed: 0, inserted: 0, updated: 0, issues: 0, ms: Date.now() - startedAt, error: message };
  }

  await reconcileIssues(source.key, runId, result.issues);

  const summary = {
    parsed: result.parsed,
    inserted: result.inserted,
    updated: result.updated,
    issues: result.issues.length,
    ...result.notes,
  };
  await admin
    .from("sheet_sync_source")
    .update({
      last_modified_time: modifiedTime,
      last_synced_at: new Date().toISOString(),
      last_status: "success",
      last_error: null,
      last_summary: summary,
    })
    .eq("id", source.id);
  await log(
    runId,
    result.issues.length ? "warn" : "info",
    `${source.name}: ${result.parsed} row(s) read, ${result.inserted} added, ${result.updated} updated, ${result.issues.length} need review.`,
    summary,
  );

  return {
    status: "success",
    parsed: result.parsed,
    inserted: result.inserted,
    updated: result.updated,
    issues: result.issues.length,
    ms: Date.now() - startedAt,
    notes: result.notes,
  };
}

async function loadSource(key: string): Promise<SheetSourceRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sheet_sync_source")
    .select("id, key, name, spreadsheet_id, enabled, config, last_modified_time")
    .eq("key", key)
    .maybeSingle();
  return (data as SheetSourceRow | null) ?? null;
}

export async function runSheetSync(options: RunOptions = {}): Promise<SheetSyncRunResult> {
  const admin = createAdminClient();
  const { only, force = false, trigger = "scheduled" } = options;

  let query = admin
    .from("sheet_sync_source")
    .select("id, key, name, spreadsheet_id, enabled, config, last_modified_time")
    .eq("enabled", true)
    .order("key");
  if (only?.length) query = query.in("key", only);
  const { data: sourceData, error: sourceErr } = await query;
  if (sourceErr) throw new Error(`load sheet_sync_source: ${sourceErr.message}`);
  const sources = (sourceData ?? []) as SheetSourceRow[];

  const { data: agent } = await admin
    .from("agent")
    .select("id")
    .eq("key", SHEET_AGENT_KEY)
    .maybeSingle();
  const agentId = (agent as { id: string } | null)?.id ?? null;

  let runId: string | null = null;
  const startedAt = new Date();
  if (agentId) {
    const { data: run } = await admin
      .from("agent_run")
      .insert({
        agent_id: agentId,
        trigger,
        status: "running",
        target_date: todayLA(),
        started_at: startedAt.toISOString(),
        triggered_by: options.triggeredBy ?? null,
        triggered_by_email: options.triggeredByEmail ?? (trigger === "scheduled" ? "system:cron" : null),
      })
      .select("id")
      .single();
    runId = (run as { id: string } | null)?.id ?? null;
  }

  const outcomes: Record<string, SourceOutcome> = {};
  for (const source of sources) {
    outcomes[source.key] = await runSource(source, runId, force);
  }

  const failed = Object.values(outcomes).filter((o) => o.status === "error").length;
  const recordsProcessed = Object.values(outcomes).reduce((sum, o) => sum + o.parsed, 0);
  const recordsNew = Object.values(outcomes).reduce((sum, o) => sum + o.inserted, 0);
  const finishedAt = new Date();

  if (runId && agentId) {
    const status = failed ? "error" : "success";
    await admin
      .from("agent_run")
      .update({
        status,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        records_processed: recordsProcessed,
        records_new: recordsNew,
        error: failed
          ? Object.entries(outcomes)
              .filter(([, o]) => o.error)
              .map(([k, o]) => `${k}: ${o.error}`)
              .join(" | ")
          : null,
        detail: outcomes,
      })
      .eq("id", runId);
    await admin
      .from("agent")
      .update({ last_run_at: finishedAt.toISOString(), last_status: status })
      .eq("id", agentId);
  }

  return { ok: failed === 0, runId, sources: outcomes };
}
