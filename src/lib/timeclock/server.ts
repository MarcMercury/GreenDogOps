import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { WORK_TZ } from "@/lib/worklist/dates";
import type { AppUser } from "@/lib/auth/permissions";
import { TIME_CLOCK_NOTICE_VERSION } from "./notice";
import type { ClockLocation } from "./location-check";
import type { LastPunch, PunchType } from "./state";
import {
  effectivePunches,
  type EffectivePunch,
  type PunchAdjustment,
  type PunchReview,
  type RawPunch,
} from "./timecard";

// Self-service time-clock reads. Every function here is scoped to ONE person,
// passed in by the caller from the signed-in user's own app_user.person_id —
// never from client input. The tables are service-role only (migration 0240),
// and Staff are read-only in the database (0239), so all of it goes through
// the service role.

export const TIME_CLOCK_TZ = WORK_TZ;

export interface SelfPerson {
  id: string;
  name: string;
  firstName: string | null;
  /** Eligible to punch: an active employee or contractor. */
  canPunch: boolean;
  /** Non-exempt (or unknown FLSA) staff sign meal waivers. */
  nonExempt: boolean;
}

export type SelfResolution =
  | { ok: true; person: SelfPerson }
  | { ok: false; reason: "no_profile" | "not_employee" };

interface PersonRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  full_name: string | null;
  status: string;
  is_active: boolean;
}

/** The HR person behind this login, if any. */
export async function resolveSelf(appUser: AppUser): Promise<SelfResolution> {
  if (!appUser.person_id) return { ok: false, reason: "no_profile" };
  const admin = createAdminClient();
  const [personRes, empRes] = await Promise.all([
    admin
      .from("person")
      .select("id, first_name, last_name, preferred_name, full_name, status, is_active")
      .eq("id", appUser.person_id)
      .maybeSingle(),
    admin.from("person_employment").select("flsa_status").eq("person_id", appUser.person_id).maybeSingle(),
  ]);
  const p = personRes.data as PersonRow | null;
  if (!p) return { ok: false, reason: "no_profile" };
  const canPunch = p.is_active && (p.status === "employee" || p.status === "contractor");
  const first = p.preferred_name?.trim() || p.first_name?.trim() || null;
  return {
    ok: true,
    person: {
      id: p.id,
      name: p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "You",
      firstName: first,
      canPunch,
      // Unknown FLSA status is treated as non-exempt: asking is the safe side.
      nonExempt: (empRes.data as { flsa_status: string | null } | null)?.flsa_status !== "exempt",
    },
  };
}

const RAW_PUNCH_COLUMNS =
  "id, punch_type, punched_at, work_date, location_id, location_check, needs_approval, assignment_id";
const ADJUSTMENT_COLUMNS =
  "id, action, punch_type, punched_at, work_date, voids_punch_id, voids_adjustment_id, reason, created_at";

/** The latest EFFECTIVE punch (adjustments applied) — what the clock state is based on. */
export async function getLastPunch(personId: string): Promise<(LastPunch & { work_date: string }) | null> {
  const { data, error } = await createAdminClient()
    .rpc("time_effective_punches", { p_person_id: personId })
    .order("punched_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not load your last punch: ${error.message}`);
  const row = ((data ?? []) as { punch_type: PunchType; punched_at: string; work_date: string }[])[0];
  return row ? { punch_type: row.punch_type, punched_at: row.punched_at, work_date: row.work_date } : null;
}

/** Clinic of the person's latest clock-in (later punches are checked against it). */
export async function getSessionLocationId(personId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("time_punch")
    .select("location_id")
    .eq("person_id", personId)
    .eq("punch_type", "clock_in")
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { location_id: string | null } | null)?.location_id ?? null;
}

/** Effective punches (punches − voids + approver adds) whose work date is in [from, to]. */
export async function getPunches(personId: string, from: string, to: string): Promise<EffectivePunch[]> {
  const admin = createAdminClient();
  const [punchRes, adjRes] = await Promise.all([
    admin
      .from("time_punch")
      .select(RAW_PUNCH_COLUMNS)
      .eq("person_id", personId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("punched_at", { ascending: true })
      .limit(2000),
    admin
      .from("time_punch_adjustment")
      .select(ADJUSTMENT_COLUMNS)
      .eq("person_id", personId)
      .gte("work_date", from)
      .lte("work_date", to)
      .limit(2000),
  ]);
  if (punchRes.error) throw new Error(`Could not load punches: ${punchRes.error.message}`);
  if (adjRes.error) throw new Error(`Could not load timecard changes: ${adjRes.error.message}`);
  const punches = (punchRes.data ?? []) as RawPunch[];
  const pendingIds = punches.filter((p) => p.needs_approval).map((p) => p.id);
  let reviews: PunchReview[] = [];
  if (pendingIds.length > 0) {
    const { data, error } = await admin.from("time_punch_review").select("punch_id, decision").in("punch_id", pendingIds);
    if (error) throw new Error(`Could not load approvals: ${error.message}`);
    reviews = (data ?? []) as PunchReview[];
  }
  return effectivePunches(punches, (adjRes.data ?? []) as PunchAdjustment[], reviews);
}

/** Active locations with their time-clock settings and active approved networks. */
export async function getClockLocations(): Promise<ClockLocation[]> {
  const admin = createAdminClient();
  const [locRes, netRes] = await Promise.all([
    admin
      .from("location")
      .select("id, name, display_name, latitude, longitude, geofence_radius_m, gps_max_accuracy_m, clock_policy")
      .eq("is_active", true),
    admin.from("location_network").select("id, location_id, cidr").eq("is_active", true),
  ]);
  if (locRes.error) throw new Error(`Could not load clinic settings: ${locRes.error.message}`);
  if (netRes.error) throw new Error(`Could not load clinic networks: ${netRes.error.message}`);
  const nets = (netRes.data ?? []) as { id: string; location_id: string; cidr: string }[];
  return ((locRes.data ?? []) as {
    id: string;
    name: string;
    display_name: string | null;
    latitude: number | null;
    longitude: number | null;
    geofence_radius_m: number;
    gps_max_accuracy_m: number;
    clock_policy: ClockLocation["clock_policy"];
  }[]).map((l) => ({
    id: l.id,
    name: l.display_name || l.name,
    latitude: l.latitude,
    longitude: l.longitude,
    geofence_radius_m: l.geofence_radius_m,
    gps_max_accuracy_m: l.gps_max_accuracy_m,
    clock_policy: l.clock_policy,
    networks: nets.filter((n) => n.location_id === l.id).map((n) => ({ id: n.id, cidr: String(n.cidr) })),
  }));
}

export interface MyShift {
  assignment_id: string;
  work_date: string;
  location_id: string;
  location_name: string;
  label: string | null;
  role: string | null;
  department: string | null;
  start_time: string | null;
  end_time: string | null;
}

interface AssignmentRow {
  id: string;
  work_date: string;
  location_id: string;
  sched_week: { status: string; is_template: boolean } | null;
  sched_week_line: {
    label: string | null;
    start_time: string | null;
    end_time: string | null;
    sched_role: { name: string } | null;
    sched_department: { name: string } | null;
  } | null;
  location: { name: string; display_name: string | null } | null;
}

/** Published shifts in [from, to], in date and start-time order. */
export async function getMyShifts(personId: string, from: string, to: string): Promise<MyShift[]> {
  const { data, error } = await createAdminClient()
    .from("sched_assignment")
    .select(
      "id, work_date, location_id, " +
        "sched_week!inner(status, is_template), " +
        "sched_week_line(label, start_time, end_time, sched_role(name), sched_department(name)), " +
        "location(name, display_name)",
    )
    .eq("person_id", personId)
    .eq("removed_post_publish", false)
    .eq("sched_week.status", "published")
    .eq("sched_week.is_template", false)
    .gte("work_date", from)
    .lte("work_date", to)
    .limit(500);
  if (error) throw new Error(`Could not load your schedule: ${error.message}`);
  const rows = (data ?? []) as unknown as AssignmentRow[];
  return rows
    .map((r) => ({
      assignment_id: r.id,
      work_date: r.work_date,
      location_id: r.location_id,
      location_name: r.location?.display_name || r.location?.name || "—",
      label: r.sched_week_line?.label ?? null,
      role: r.sched_week_line?.sched_role?.name ?? null,
      department: r.sched_week_line?.sched_department?.name ?? null,
      start_time: r.sched_week_line?.start_time ?? null,
      end_time: r.sched_week_line?.end_time ?? null,
    }))
    .sort(
      (a, b) =>
        a.work_date.localeCompare(b.work_date) || (a.start_time ?? "99").localeCompare(b.start_time ?? "99"),
    );
}

/** Location display names by id (for punches made at unscheduled locations). */
export async function getLocationNames(): Promise<Map<string, string>> {
  const { data } = await createAdminClient().from("location").select("id, name, display_name");
  return new Map(
    ((data ?? []) as { id: string; name: string; display_name: string | null }[]).map((l) => [
      l.id,
      l.display_name || l.name,
    ]),
  );
}

export async function hasAckedNotice(personId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("time_clock_notice_ack")
    .select("person_id")
    .eq("person_id", personId)
    .eq("notice_version", TIME_CLOCK_NOTICE_VERSION)
    .maybeSingle();
  return !!data;
}

export interface MyCorrection {
  id: string;
  work_date: string;
  kind: "missing_punch" | "wrong_time" | "other";
  punch_type: PunchType | null;
  requested_time: string | null;
  reason: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  review_note: string | null;
  created_at: string;
}

export async function getMyCorrections(personId: string, limit = 50): Promise<MyCorrection[]> {
  const { data, error } = await createAdminClient()
    .from("time_correction_request")
    .select("id, work_date, kind, punch_type, requested_time, reason, status, review_note, created_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load correction requests: ${error.message}`);
  return (data ?? []) as MyCorrection[];
}
