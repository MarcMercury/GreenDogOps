"use server";

import { requireUser } from "@/lib/auth/session";
import { canUseSmartReport, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { smartScopeFor } from "@/lib/reporting/smart-scope";
import { askSmartReport, type SmartResult, type SmartTurn } from "@/lib/reporting/smart";

const MAX_QUESTION_CHARS = 800;
const HISTORY_LIMIT = 40;

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

/**
 * Answer one Smart Report question. Runs with the service-role client (the
 * smart_query RPC is service_role-only), so the checks here are the only access
 * gate: canUseSmartReport decides who may ask at all, and smartScopeFor decides
 * which tables and columns their question is allowed to reach.
 *
 * Every question is logged: it is the user's private history, and an answer an
 * admin confirms becomes a worked example for future questions.
 */
export async function askSmartQuestion(
  question: string,
  history: SmartTurn[] = [],
): Promise<SmartAnswer> {
  const current = await requireUser();
  if (!canUseSmartReport(current.appUser)) {
    throw new Error("You do not have access to Smart Report.");
  }
  const scope = smartScopeFor(current.appUser.role);

  const q = typeof question === "string" ? question.trim().slice(0, MAX_QUESTION_CHARS) : "";
  const turns: SmartTurn[] = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .map((t) => ({ role: t.role, content: t.content.slice(0, 600) }));

  const admin = createAdminClient();
  const startedAt = Date.now();
  let result: SmartResult;
  try {
    result = await askSmartReport(admin, q, scope, turns);
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
  if (q) {
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
  const current = await requireUser();
  if (!canUseSmartReport(current.appUser)) return [];
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
  if (!canUseSmartReport(current.appUser)) return { ok: false, verified: false };
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
