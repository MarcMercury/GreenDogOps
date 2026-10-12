import "server-only";

// Loads the people the notification engine can address: active employees and
// contractors with their login, connected Slack account, home location and
// scheduling departments. Service role; nothing here leaves the server.

import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/auth/permissions";
import type { DirectoryPerson } from "./audience";

interface PersonRow {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

export function personDisplayName(p: Pick<PersonRow, "full_name" | "first_name" | "last_name" | "preferred_name">): string {
  const first = p.preferred_name?.trim() || p.first_name?.trim();
  const named = [first, p.last_name?.trim()].filter(Boolean).join(" ");
  return named || p.full_name?.trim() || "Someone";
}

const APP_USER_COLUMNS =
  "id, email, full_name, title, role, is_active, module_access, notes, person_id, last_seen_at, created_at, updated_at";

export async function loadDirectory(): Promise<DirectoryPerson[]> {
  const admin = createAdminClient();
  const [people, logins, links, employment, members, roles] = await Promise.all([
    admin
      .from("person")
      .select("id, full_name, first_name, last_name, preferred_name")
      .in("status", ["employee", "contractor"])
      .limit(5000),
    admin.from("app_user").select(APP_USER_COLUMNS).eq("is_active", true).not("person_id", "is", null).limit(5000),
    admin
      .from("person_slack_link")
      .select("person_id, slack_user_id")
      .eq("status", "connected")
      .not("slack_user_id", "is", null)
      .limit(5000),
    admin.from("person_employment").select("person_id, location_id").limit(5000),
    admin.from("sched_role_member").select("person_id, role_id").limit(10000),
    admin.from("sched_role").select("id, department_id").limit(5000),
  ]);
  for (const r of [people, logins, links, employment, members, roles]) {
    if (r.error) throw new Error(`Loading the notification directory failed: ${r.error.message}`);
  }

  const loginByPerson = new Map<string, AppUser>();
  for (const u of (logins.data ?? []) as AppUser[]) {
    if (u.person_id && !loginByPerson.has(u.person_id)) loginByPerson.set(u.person_id, u);
  }
  const slackByPerson = new Map(
    ((links.data ?? []) as { person_id: string; slack_user_id: string }[]).map((l) => [l.person_id, l.slack_user_id]),
  );
  const locationByPerson = new Map(
    ((employment.data ?? []) as { person_id: string; location_id: string | null }[]).map((e) => [e.person_id, e.location_id]),
  );
  const deptByRole = new Map(
    ((roles.data ?? []) as { id: string; department_id: string }[]).map((r) => [r.id, r.department_id]),
  );
  const deptsByPerson = new Map<string, Set<string>>();
  for (const m of (members.data ?? []) as { person_id: string; role_id: string }[]) {
    const dept = deptByRole.get(m.role_id);
    if (!dept) continue;
    const set = deptsByPerson.get(m.person_id) ?? new Set<string>();
    set.add(dept);
    deptsByPerson.set(m.person_id, set);
  }

  return ((people.data ?? []) as PersonRow[]).map((p) => ({
    personId: p.id,
    name: personDisplayName(p),
    locationId: locationByPerson.get(p.id) ?? null,
    departmentIds: [...(deptsByPerson.get(p.id) ?? [])],
    slackUserId: slackByPerson.get(p.id) ?? null,
    login: loginByPerson.get(p.id) ?? null,
  }));
}

/** One person's directory entry (send-time re-checks). */
export async function loadDirectoryPerson(personId: string): Promise<DirectoryPerson | null> {
  const admin = createAdminClient();
  const [{ data: person }, { data: login }, { data: link }] = await Promise.all([
    admin
      .from("person")
      .select("id, full_name, first_name, last_name, preferred_name, status")
      .eq("id", personId)
      .maybeSingle(),
    admin.from("app_user").select(APP_USER_COLUMNS).eq("person_id", personId).eq("is_active", true).limit(1),
    admin.from("person_slack_link").select("status, slack_user_id").eq("person_id", personId).maybeSingle(),
  ]);
  const p = person as (PersonRow & { status: string }) | null;
  if (!p || (p.status !== "employee" && p.status !== "contractor")) return null;
  const l = link as { status: string; slack_user_id: string | null } | null;
  return {
    personId: p.id,
    name: personDisplayName(p),
    locationId: null,
    departmentIds: [],
    slackUserId: l?.status === "connected" ? l.slack_user_id : null,
    login: ((login as AppUser[] | null) ?? [])[0] ?? null,
  };
}
