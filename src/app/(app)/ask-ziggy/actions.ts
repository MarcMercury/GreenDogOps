"use server";

import { requireUser } from "@/lib/auth/session";
import { canAccessModule, isAdminRole, type AppUser } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { scopeForUser } from "@/lib/reporting/smart-scope";
import { askSmartReport, type SmartResult, type SmartTurn } from "@/lib/reporting/smart";
import { formatAskerContext, getAskerFacts } from "@/lib/reporting/ziggy-context";

const MAX_QUESTION_CHARS = 800;
const HISTORY_LIMIT = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chat turn from the browser. An answer carries its log id, never its SQL. */
export interface SmartChatTurn {
  role: "user" | "assistant";
  content: string;
  logId?: string | null;
}

export interface SmartHistoryEntry {
  id: string;
  question: string;
  ok: boolean;
  row_count: number;
  feedback: number | null;
  verified: boolean;
  created_at: string;
}

/** A logged answer the user can rate. `logId` is null when logging failed. */
export interface SmartAnswer extends SmartResult {
  logId: string | null;
}

const canUseAskZiggy = (user: AppUser) => canAccessModule(user, "ask_ziggy");

/**
 * Answer one Ask Ziggy question. Runs with the service-role client (the
 * smart_query RPC is service_role-only), so the checks here are the only access
 * gate: the ask_ziggy module decides who may ask at all, and scopeForUser
 * decides which tables and columns their question is allowed to reach.
 *
 * Every question is logged: it is the user's private history, and an answer an
 * admin confirms becomes a worked example for future questions.
 *
 * Answering is a pure read, so it runs during a "View as" preview with the
 * previewed user's scope — but a preview question is never logged, so it
 * cannot land in that user's private history or become a worked example.
 *
 * Failures are returned, not thrown: a thrown Server Action message is
 * replaced by a generic React error in production.
 */
export async function askSmartQuestion(
  question: string,
  history: SmartChatTurn[] = [],
): Promise<SmartAnswer> {
  const current = await requireUser({ allowPreview: true });
  if (!canUseAskZiggy(current.appUser)) {
    return {
      ok: false,
      answer: "You do not have access to Ask Ziggy.",
      sql: null,
      rows: [],
      columns: [],
      rowCount: 0,
      truncated: false,
      provider: null,
      attempts: [],
      logId: null,
    };
  }
  const scope = scopeForUser(current.appUser);
  const isPreview = !!current.viewAs;

  const q = typeof question === "string" ? question.trim().slice(0, MAX_QUESTION_CHARS) : "";
  const recent = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string");

  const admin = createAdminClient();

  // A follow-up ("now remove the 101 clients") must edit the query behind the
  // last answer, so load it — from this user's own log, never from the browser.
  const lastLogId = recent.findLast(
    (t) => t.role === "assistant" && typeof t.logId === "string" && UUID.test(t.logId),
  )?.logId;
  let lastSql: string | null = null;
  if (lastLogId && !isPreview) {
    const { data } = await admin
      .from("smart_question_log")
      .select("sql")
      .eq("id", lastLogId)
      .eq("app_user_id", current.appUser.id)
      .maybeSingle();
    lastSql = typeof data?.sql === "string" ? data.sql : null;
  }
  const turns: SmartTurn[] = recent.map((t) => ({
    role: t.role,
    content: t.content.slice(0, 600),
    sql: t.role === "assistant" && t.logId === lastLogId ? lastSql : null,
  }));

  const startedAt = Date.now();
  let result: SmartResult;
  try {
    // The asker's own shifts/PTO are fetched by their person_id here, never
    // through the model's SQL. A failure only costs the personal answers.
    const asker = await getAskerFacts(admin, current.appUser, current.email)
      .then(formatAskerContext)
      .catch(() => null);
    result = await askSmartReport(admin, q, scope, turns, asker, current.appUser.id);
  } catch (e) {
    result = {
      ok: false,
      answer: e instanceof Error ? e.message : "Something went wrong answering that question.",
      sql: null,
      rows: [],
      columns: [],
      rowCount: 0,
      truncated: false,
      provider: null,
      attempts: [],
    };
  }

  let logId: string | null = null;
  if (q && !isPreview) {
    // Result rows are deliberately not stored — history re-runs the question so
    // the numbers are fresh and no client data sits in the log.
    const { data } = await admin
      .from("smart_question_log")
      .insert({
        app_user_id: current.appUser.id,
        user_email: current.email,
        user_role: current.appUser.role,
        question: q,
        sql: result.sql,
        ok: result.ok,
        row_count: result.rowCount,
        answer: result.answer.slice(0, 4000),
        error: result.ok ? null : result.answer.slice(0, 1000),
        attempts: result.attempts,
        provider: result.provider,
        duration_ms: Date.now() - startedAt,
      })
      .select("id")
      .maybeSingle();
    logId = (data as { id: string } | null)?.id ?? null;
  }

  return { ...result, logId };
}

/** The signed-in user's own recent questions, newest first. History is private. */
export async function getSmartHistory(): Promise<SmartHistoryEntry[]> {
  const current = await requireUser({ allowPreview: true });
  if (!canUseAskZiggy(current.appUser)) return [];
  // History is private, so a "View as" preview never reveals someone else's.
  if (current.viewAs?.kind === "user") return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("smart_question_log")
    .select("id, question, ok, row_count, feedback, verified, created_at")
    .eq("app_user_id", current.appUser.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  return (data ?? []) as SmartHistoryEntry[];
}

/**
 * Rate an answer. A thumbs-up from an admin also marks the question/SQL pair
 * VERIFIED, which is what lets it be used as a worked example later — a query
 * that merely ran without error must never train the prompt.
 */
export async function rateSmartAnswer(
  logId: string,
  rating: 1 | -1,
  note?: string,
): Promise<{ ok: boolean; verified: boolean }> {
  const current = await requireUser();
  if (!canUseAskZiggy(current.appUser)) return { ok: false, verified: false };
  if (rating !== 1 && rating !== -1) return { ok: false, verified: false };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("smart_question_log")
    .select("id, app_user_id, sql")
    .eq("id", logId)
    .maybeSingle();
  const entry = row as { id: string; app_user_id: string | null; sql: string | null } | null;
  // You may only rate your own answers.
  if (!entry || entry.app_user_id !== current.appUser.id) {
    return { ok: false, verified: false };
  }

  const verified = rating === 1 && isAdminRole(current.appUser.role) && !!entry.sql;
  const { error } = await admin
    .from("smart_question_log")
    .update({
      feedback: rating,
      feedback_note: note?.slice(0, 500) ?? null,
      verified,
      verified_by: verified ? current.appUser.id : null,
      verified_at: verified ? new Date().toISOString() : null,
    })
    .eq("id", logId);
  return { ok: !error, verified };
}
