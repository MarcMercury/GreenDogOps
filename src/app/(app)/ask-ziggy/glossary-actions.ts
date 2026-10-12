"use server";

import { requireUser } from "@/lib/auth/session";
import { canUseSmartReport, canEditModule, isAdminRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { callTextLLM, hasLlmProvider, unwrapJson } from "@/lib/ai/llm";

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
  sql_hint: string | null;
  status: "draft" | "active" | "archived";
  source: "manual" | "suggested";
  source_note: string | null;
  updated_at: string;
}

/** Editing the shared glossary follows the Reporting module's edit right. */
async function requireGlossaryEditor() {
  const current = await requireUser();
  if (!canUseSmartReport(current.appUser)) {
    throw new Error("You do not have access to Smart Report.");
  }
  if (!canEditModule(current.appUser, "reporting") && !isAdminRole(current.appUser.role)) {
    throw new Error("You do not have permission to edit the glossary.");
  }
  return current;
}

export async function getGlossaryEntries(): Promise<GlossaryEntry[]> {
  const current = await requireUser();
  if (!canUseSmartReport(current.appUser)) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("smart_glossary")
    .select("id, term, aliases, definition, sql_hint, status, source, source_note, updated_at")
    .neq("status", "archived")
    // Drafts awaiting review float to the top.
    .order("status", { ascending: true })
    .order("term", { ascending: true });
  return (data ?? []) as GlossaryEntry[];
}

export async function saveGlossaryEntry(entry: {
  id?: string;
  term: string;
  aliases: string[];
  definition: string;
  sql_hint?: string | null;
  status?: "draft" | "active";
}): Promise<{ ok: boolean; error?: string }> {
  const current = await requireGlossaryEditor();
  const term = entry.term?.trim();
  const definition = entry.definition?.trim();
  if (!term || !definition) return { ok: false, error: "A term and a definition are required." };

  const row = {
    term: term.slice(0, 120),
    aliases: (entry.aliases ?? [])
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 20),
    definition: definition.slice(0, 2000),
    sql_hint: entry.sql_hint?.trim().slice(0, 2000) || null,
    status: entry.status ?? "active",
    updated_by: current.appUser.id,
  };

  const admin = createAdminClient();
  const { error } = entry.id
    ? await admin.from("smart_glossary").update(row).eq("id", entry.id)
    : await admin
        .from("smart_glossary")
        .insert({ ...row, source: "manual", created_by: current.appUser.id });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "That term is already in the glossary." : error.message,
    };
  }
  return { ok: true };
}

export async function removeGlossaryEntry(id: string): Promise<{ ok: boolean }> {
  await requireGlossaryEditor();
  const admin = createAdminClient();
  // Archive rather than delete so a term can be brought back.
  const { error } = await admin
    .from("smart_glossary")
    .update({ status: "archived" })
    .eq("id", id);
  return { ok: !error };
}

const SUGGEST_SYSTEM = `You maintain the business glossary for a veterinary practice's AI reporting tool.
You are given real questions staff asked it, with the SQL it produced and any errors it hit first.
Propose glossary entries for the BUSINESS PHRASES in those questions whose meaning is not obvious
from column names alone — a phrase the practice uses that needs a rule, a preferred table, or a
warning about a wrong-but-tempting interpretation.

Rules:
- Only propose a term if the questions show real evidence for it. Fewer, better entries.
- Skip anything already covered by the existing glossary terms listed below.
- "aliases" are OTHER WAYS STAFF ACTUALLY PHRASED IT in these questions — take them from the
  questions, do not invent synonyms.
- "definition" is one or two plain sentences a manager would agree with.
- "sql_hint" is the canonical table/filter/expression, or null if there isn't a clean one.
- Never invent tables or columns. If a question failed and you cannot tell what it meant, skip it.

Reply with JSON only: {"entries":[{"term":"...","aliases":["..."],"definition":"...","sql_hint":"..."}]}
Return {"entries":[]} if nothing is worth adding.`;

/**
 * Draft glossary entries from the question log so the glossary fills itself in.
 * Looks at what people actually asked — especially questions that failed or
 * needed retries — and writes DRAFT entries for a human to accept or edit.
 */
export async function suggestGlossaryEntries(): Promise<{
  ok: boolean;
  added: number;
  error?: string;
}> {
  await requireGlossaryEditor();
  if (!hasLlmProvider()) return { ok: false, added: 0, error: "No AI provider is configured." };

  const admin = createAdminClient();
  const [{ data: logs }, { data: existing }] = await Promise.all([
    admin
      .from("smart_question_log")
      .select("question, sql, ok, attempts, feedback")
      .order("created_at", { ascending: false })
      .limit(120),
    admin.from("smart_glossary").select("term, aliases"),
  ]);

  const rows = (logs ?? []) as {
    question: string;
    sql: string | null;
    ok: boolean;
    attempts: { sql: string; error: string }[];
    feedback: number | null;
  }[];
  if (rows.length < 5) {
    return { ok: false, added: 0, error: "Not enough questions logged yet — ask a few more first." };
  }

  // A question that struggled teaches more than one that sailed through.
  const scored = [...rows].sort(
    (a, b) =>
      Number(b.feedback === -1) - Number(a.feedback === -1) ||
      Number(!b.ok) - Number(!a.ok) ||
      (b.attempts?.length ?? 0) - (a.attempts?.length ?? 0),
  );
  const known = ((existing ?? []) as { term: string; aliases: string[] }[])
    .map((g) => [g.term, ...(g.aliases ?? [])].join(", "))
    .join("\n");

  const sample = scored
    .slice(0, 60)
    .map((r, i) => {
      const trouble = !r.ok
        ? " [FAILED]"
        : r.feedback === -1
          ? " [MARKED WRONG]"
          : r.attempts?.length
            ? ` [${r.attempts.length} failed drafts]`
            : "";
      return `${i + 1}. ${r.question}${trouble}${r.sql ? `\n   SQL: ${r.sql.slice(0, 300)}` : ""}`;
    })
    .join("\n");

  const reply = await callTextLLM(
    SUGGEST_SYSTEM,
    `Existing glossary terms (do not repeat these):\n${known || "(none)"}\n\nRecent questions:\n${sample}`,
    { json: true, maxTokens: 3000, thinkingBudget: 1024 },
  );
  if (!reply.ok) return { ok: false, added: 0, error: reply.error };

  let parsed: { entries?: { term?: string; aliases?: string[]; definition?: string; sql_hint?: string }[] };
  try {
    parsed = JSON.parse(unwrapJson(reply.content));
  } catch {
    return { ok: false, added: 0, error: "The suggestion could not be read. Try again." };
  }

  const knownTerms = new Set(
    ((existing ?? []) as { term: string }[]).map((g) => g.term.trim().toLowerCase()),
  );
  const drafts = (parsed.entries ?? [])
    .filter((e) => e.term?.trim() && e.definition?.trim())
    // The unique index is on lower(term), which an upsert can't target, so skip
    // anything already in the glossary rather than overwriting a team edit.
    .filter((e) => !knownTerms.has(e.term!.trim().toLowerCase()))
    .slice(0, 10)
    .map((e) => ({
      term: e.term!.trim().slice(0, 120),
      aliases: (e.aliases ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 20),
      definition: e.definition!.trim().slice(0, 2000),
      sql_hint: e.sql_hint?.trim().slice(0, 2000) || null,
      status: "draft" as const,
      source: "suggested" as const,
      source_note: `Drafted from ${rows.length} logged questions`,
    }));
  if (!drafts.length) return { ok: true, added: 0 };

  const { data: inserted, error } = await admin
    .from("smart_glossary")
    .insert(drafts)
    .select("id");
  if (error) return { ok: false, added: 0, error: error.message };
  return { ok: true, added: (inserted ?? []).length };
}
