import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { JobHire } from "./jobs";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Employees who were hired through the ATS into a job. Hired candidates leave
 * the ATS list (status = employee), so the Jobs board reads them separately to
 * show "hired / openings".
 */
export async function loadJobHires(supabase: Supabase, positionId?: string): Promise<JobHire[]> {
  let query = supabase
    .from("person_recruiting")
    .select(
      "target_position_id, person!inner(id, status, full_name, first_name, last_name, person_employment(hire_date))",
    )
    .not("target_position_id", "is", null)
    .eq("person.status", "employee");
  if (positionId) query = query.eq("target_position_id", positionId);
  const { data, error } = await query;
  if (error) {
    console.error("[ats] job hires lookup failed:", error.message);
    return [];
  }
  const out: JobHire[] = [];
  for (const r of (data ?? []) as Array<{ target_position_id: string; person: unknown }>) {
    const p = one(
      r.person as
        | {
            id: string;
            full_name: string | null;
            first_name: string | null;
            last_name: string | null;
            person_employment: unknown;
          }
        | null,
    );
    if (!p) continue;
    const emp = one(p.person_employment as { hire_date: string | null } | null);
    out.push({
      position_id: r.target_position_id,
      person_id: p.id,
      name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Employee",
      hire_date: emp?.hire_date ?? null,
    });
  }
  return out;
}
