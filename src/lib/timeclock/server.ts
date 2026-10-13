import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { WORK_TZ } from "@/lib/worklist/dates";
import type { AppUser } from "@/lib/auth/permissions";
import { TIME_CLOCK_NOTICE_VERSION } from "./notice";
import type { PunchType } from "./state";
import type { Punch } from "./timecard";

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
  /** Non-exempt staff answer the rest-break question at clock-out. */
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

export interface MyPunch extends Punch {
  location_check: string;
}

const PUNCH_COLUMNS = "id, punch_type, punched_at, work_date, location_id, rest_breaks_ok, location_check";

export async function getLastPunch(personId: string): Promise<MyPunch | null> {
  const { data } = await createAdminClient()
    .from("time_punch")
    .select(PUNCH_COLUMNS)
    .eq("person_id", personId)
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MyPunch | null) ?? null;
}

/** Punches whose work date falls in [from, to]. */
export async function getPunches(personId: string, from: string, to: string): Promise<MyPunch[]> {
  const { data, error } = await createAdminClient()
    .from("time_punch")
    .select(PUNCH_COLUMNS)
    .eq("person_id", personId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("punched_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`Could not load punches: ${error.message}`);
  return (data ?? []) as MyPunch[];
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
