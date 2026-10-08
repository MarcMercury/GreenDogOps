import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  COMPENSATION_FIELDS,
  type PersonEmployment,
  type RosterRow,
} from "./types";

/**
 * Compensation columns on person_employment are not granted to the API role
 * (migration 0227), so they are read and written only through the service-role
 * client. Callers MUST have already applied the app-level check
 * (canViewAllCompensation, or the viewer's own linked record).
 */

type CompRow = Pick<PersonEmployment, "person_id"> &
  Partial<Pick<PersonEmployment, (typeof COMPENSATION_FIELDS)[number]>>;

const COMP_SELECT = ["person_id", ...COMPENSATION_FIELDS].join(", ");

/** Load compensation for the given people (or everyone), keyed by person id. */
export async function loadCompensation(
  personIds: string[] | "all",
): Promise<Map<string, CompRow>> {
  const out = new Map<string, CompRow>();
  if (personIds !== "all" && personIds.length === 0) return out;
  const admin = createAdminClient();

  const { data, error } = await fetchAllRows<CompRow>((from, to) => {
    let q = admin.from("person_employment").select(COMP_SELECT);
    if (personIds !== "all") q = q.in("person_id", personIds);
    return q.order("person_id").range(from, to) as unknown as PromiseLike<{
      data: CompRow[] | null;
      error: { message: string } | null;
    }>;
  });
  if (error) {
    console.error("[hr] load compensation failed:", error.message);
    return out;
  }
  for (const row of data) out.set(row.person_id, row);
  return out;
}

/**
 * Overlay compensation onto a roster row. Rows without a loaded compensation
 * record get every compensation field set to null, so the shape is identical
 * either way.
 */
export function withCompensation(row: RosterRow, comp: CompRow | undefined): RosterRow {
  if (!row.person_employment) return row;
  const emp = { ...row.person_employment } as Record<string, unknown>;
  for (const field of COMPENSATION_FIELDS) {
    emp[field] = comp ? (comp[field] ?? null) : null;
  }
  return { ...row, person_employment: emp as unknown as PersonEmployment };
}

/** Write compensation fields with the service role (after the caller's gate). */
export async function upsertCompensation(
  personId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const allowed = new Set<string>(COMPENSATION_FIELDS);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.has(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return { error: null };
  const admin = createAdminClient();
  const { error } = await admin
    .from("person_employment")
    .upsert({ person_id: personId, ...clean }, { onConflict: "person_id" });
  return { error: error?.message ?? null };
}

/** Current pay rate for one person (service role). */
export async function currentRate(personId: string): Promise<{ found: boolean; rate: number | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("person_employment")
    .select("current_rate")
    .eq("person_id", personId)
    .maybeSingle();
  const row = data as { current_rate: number | null } | null;
  return { found: row != null, rate: row?.current_rate ?? null };
}
