"use server";

import { requireUser } from "@/lib/auth/session";
import { canUseSmartReport } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { smartScopeFor } from "@/lib/reporting/smart-scope";
import { askSmartReport, type SmartResult, type SmartTurn } from "@/lib/reporting/smart";

const MAX_QUESTION_CHARS = 800;

/**
 * Answer one Smart Report question. Runs with the service-role client (the
 * smart_query RPC is service_role-only), so the checks here are the only access
 * gate: canUseSmartReport decides who may ask at all, and smartScopeFor decides
 * which tables and columns their question is allowed to reach.
 */
export async function askSmartQuestion(
  question: string,
  history: SmartTurn[] = [],
): Promise<SmartResult> {
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

  try {
    return await askSmartReport(createAdminClient(), q, scope, turns);
  } catch (e) {
    return {
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
}
