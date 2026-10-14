import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { addDays, todayInWorkTz } from "@/lib/worklist/dates";
import { getPunches } from "./server";
import type { PunchType } from "./state";
import {
  buildSessions,
  effectivePunches,
  type EffectivePunch,
  type PunchAdjustment,
  type PunchReview,
  type RawPunch,
} from "./timecard";

// Approver queues (go-live plan D9). Service role; callers must have checked
// canReviewTimeClock() — and canApproveTime() before showing punch evidence.

/** How far back the queues look. */
export const OFFSITE_LOOKBACK_DAYS = 60;
export const MISSING_PUNCH_LOOKBACK_DAYS = 14;

interface PersonRow {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

async function personNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await createAdminClient()
    .from("person")
    .select("id, full_name, preferred_name, first_name, last_name")
    .in("id", unique);
  if (error) throw new Error(`Could not load names: ${error.message}`);
  return new Map(
    ((data ?? []) as PersonRow[]).map((p) => [
      p.id,
      p.full_name?.trim() || [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown",
    ]),
  );
}

export interface OffsiteItem {
  punch_id: string;
  person_id: string;
  person_name: string;
  punch_type: PunchType;
  punched_at: string;
  work_date: string;
  note: string | null;
  location_id: string | null;
  distance_m: number | null;
  /** Evidence — show only to approvers. */
  ip: string | null;
  user_agent: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
}

/** Off-site punches with no decision yet (and not voided by a correction). */
export async function getPendingOffsite(): Promise<OffsiteItem[]> {
  const admin = createAdminClient();
  const since = addDays(todayInWorkTz(), -OFFSITE_LOOKBACK_DAYS);
  const { data, error } = await admin
    .from("time_punch")
    .select("id, person_id, punch_type, punched_at, work_date, note, location_id, distance_m, ip, user_agent, latitude, longitude, accuracy_m")
    .eq("needs_approval", true)
    .gte("work_date", since)
    .order("punched_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Could not load off-site punches: ${error.message}`);
  const rows = (data ?? []) as (Omit<OffsiteItem, "punch_id" | "person_name"> & { id: string })[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [reviews, voids, names] = await Promise.all([
    admin.from("time_punch_review").select("punch_id").in("punch_id", ids),
    admin.from("time_punch_adjustment").select("voids_punch_id").in("voids_punch_id", ids),
    personNames(rows.map((r) => r.person_id)),
  ]);
  if (reviews.error) throw new Error(`Could not load approvals: ${reviews.error.message}`);
  if (voids.error) throw new Error(`Could not load corrections: ${voids.error.message}`);
  const done = new Set([
    ...(reviews.data ?? []).map((r) => r.punch_id as string),
    ...(voids.data ?? []).map((r) => r.voids_punch_id as string),
  ]);
  return rows
    .filter((r) => !done.has(r.id))
    .map(({ id, ...r }) => ({ ...r, punch_id: id, person_name: names.get(r.person_id) ?? "Unknown" }));
}

export interface CorrectionItem {
  id: string;
  person_id: string;
  person_name: string;
  work_date: string;
  kind: "missing_punch" | "wrong_time" | "other";
  punch_type: PunchType | null;
  requested_time: string | null;
  reason: string;
  created_at: string;
  /** That day's effective punches (for "which punch is wrong?" and context). */
  day_punches: EffectivePunch[];
}

export async function getPendingCorrections(): Promise<CorrectionItem[]> {
  const { data, error } = await createAdminClient()
    .from("time_correction_request")
    .select("id, person_id, work_date, kind, punch_type, requested_time, reason, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not load correction requests: ${error.message}`);
  const rows = (data ?? []) as Omit<CorrectionItem, "person_name" | "day_punches">[];
  const names = await personNames(rows.map((r) => r.person_id));
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      person_name: names.get(r.person_id) ?? "Unknown",
      day_punches: await getPunches(r.person_id, r.work_date, r.work_date),
    })),
  );
}

export interface MissingItem {
  person_id: string;
  person_name: string;
  work_date: string;
  status: "missing_clock_out" | "missing_clock_in";
  /** The session's first punch, for context. */
  first_punch_at: string;
  first_punch_type: PunchType;
  /** The employee has already asked for a correction for this day. */
  has_request: boolean;
}

/** Sessions with no clock-out (abandoned) or no clock-in, in the last two weeks. */
export async function getMissingPunches(now: Date = new Date()): Promise<MissingItem[]> {
  const admin = createAdminClient();
  const to = todayInWorkTz(now);
  const from = addDays(to, -MISSING_PUNCH_LOOKBACK_DAYS);
  const [punchRes, adjRes, reqRes] = await Promise.all([
    fetchAllRows<RawPunch & { person_id: string }>((a, b) =>
      admin
        .from("time_punch")
        .select("id, person_id, punch_type, punched_at, work_date, location_id, location_check, needs_approval")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("id")
        .range(a, b),
    ),
    fetchAllRows<PunchAdjustment & { person_id: string }>((a, b) =>
      admin
        .from("time_punch_adjustment")
        .select("id, person_id, action, punch_type, punched_at, work_date, voids_punch_id, voids_adjustment_id, reason, created_at")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("id")
        .range(a, b),
    ),
    admin.from("time_correction_request").select("person_id, work_date").eq("status", "pending").gte("work_date", from),
  ]);
  if (punchRes.error) throw new Error(`Could not load punches: ${punchRes.error.message}`);
  if (adjRes.error) throw new Error(`Could not load timecard changes: ${adjRes.error.message}`);
  if (reqRes.error) throw new Error(`Could not load correction requests: ${reqRes.error.message}`);

  const pendingIds = punchRes.data.filter((p) => p.needs_approval).map((p) => p.id);
  let reviews: PunchReview[] = [];
  if (pendingIds.length > 0) {
    const { data, error } = await admin.from("time_punch_review").select("punch_id, decision").in("punch_id", pendingIds);
    if (error) throw new Error(`Could not load approvals: ${error.message}`);
    reviews = (data ?? []) as PunchReview[];
  }

  const byPerson = new Map<string, { punches: RawPunch[]; adjustments: PunchAdjustment[] }>();
  const bucket = (id: string) => {
    const b = byPerson.get(id) ?? { punches: [], adjustments: [] };
    byPerson.set(id, b);
    return b;
  };
  for (const p of punchRes.data) bucket(p.person_id).punches.push(p);
  for (const a of adjRes.data) bucket(a.person_id).adjustments.push(a);
  const requested = new Set(((reqRes.data ?? []) as { person_id: string; work_date: string }[]).map((r) => `${r.person_id}|${r.work_date}`));

  const items: Omit<MissingItem, "person_name">[] = [];
  for (const [personId, b] of byPerson) {
    for (const s of buildSessions(effectivePunches(b.punches, b.adjustments, reviews), now)) {
      if (s.status !== "missing_clock_out" && s.status !== "missing_clock_in") continue;
      const first = s.punches[0];
      items.push({
        person_id: personId,
        work_date: s.work_date,
        status: s.status,
        first_punch_at: first.punched_at,
        first_punch_type: first.punch_type,
        has_request: requested.has(`${personId}|${s.work_date}`),
      });
    }
  }
  const names = await personNames(items.map((i) => i.person_id));
  return items
    .map((i) => ({ ...i, person_name: names.get(i.person_id) ?? "Unknown" }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.person_name.localeCompare(b.person_name));
}

/** Pending counts for the Work Center (cheap: no session building). */
export async function getPendingCounts(): Promise<{ offsite: number; corrections: number }> {
  const [offsite, corrections] = await Promise.all([getPendingOffsite(), createAdminClient()
    .from("time_correction_request")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")]);
  if (corrections.error) throw new Error(corrections.error.message);
  return { offsite: offsite.length, corrections: corrections.count ?? 0 };
}
