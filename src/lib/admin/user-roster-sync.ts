import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";

type AppUserRow = {
  id: string;
  email: string | null;
  person_id: string | null;
  full_name: string | null;
  title: string | null;
};

type PersonRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

type EmploymentRow = {
  person_id: string;
  adp_job_title: string | null;
  offer_title: string | null;
};

export interface UserRosterSyncResult {
  scannedUsers: number;
  matchedByEmail: number;
  refreshedProfiles: number;
  updatedUsers: number;
}

function normEmail(email: string | null): string | null {
  if (!email) return null;
  const v = email.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

function personName(p: PersonRow): string | null {
  return (
    p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null
  );
}

/**
 * Refresh app-user roster links and profile fields from HR person records.
 * - Auto-links unlinked app users by unique email match.
 * - Syncs full_name/title from roster for linked users.
 */
export async function syncAppUsersToRoster(): Promise<UserRosterSyncResult> {
  const admin = createAdminClient();

  const [{ data: users, error: usersErr }, { data: people, error: peopleErr }, { data: empRows, error: empErr }] =
    await Promise.all([
      fetchAllRows<AppUserRow>((from, to) =>
        admin
          .from("app_user")
          .select("id, email, person_id, full_name, title")
          .range(from, to),
      ),
      fetchAllRows<PersonRow>((from, to) =>
        admin
          .from("person")
          .select("id, email, full_name, first_name, last_name")
          .range(from, to),
      ),
      fetchAllRows<EmploymentRow>((from, to) =>
        admin
          .from("person_employment")
          .select("person_id, adp_job_title, offer_title")
          .range(from, to),
      ),
    ]);

  if (usersErr) throw new Error(usersErr.message);
  if (peopleErr) throw new Error(peopleErr.message);
  if (empErr) throw new Error(empErr.message);

  const peopleById = new Map<string, PersonRow>();
  const peopleByEmail = new Map<string, string[]>();
  for (const p of people) {
    peopleById.set(p.id, p);
    const email = normEmail(p.email);
    if (!email) continue;
    const list = peopleByEmail.get(email) ?? [];
    list.push(p.id);
    peopleByEmail.set(email, list);
  }

  const titleByPersonId = new Map<string, string | null>();
  for (const e of empRows) {
    titleByPersonId.set(e.person_id, e.adp_job_title ?? e.offer_title ?? null);
  }

  let matchedByEmail = 0;
  let refreshedProfiles = 0;
  let updatedUsers = 0;

  for (const user of users) {
    const email = normEmail(user.email);
    let nextPersonId = user.person_id;

    if (!nextPersonId && email) {
      const matches = peopleByEmail.get(email) ?? [];
      if (matches.length === 1) {
        nextPersonId = matches[0];
      }
    }

    let nextFullName = user.full_name;
    let nextTitle = user.title;
    if (nextPersonId) {
      const person = peopleById.get(nextPersonId);
      if (person) {
        nextFullName = personName(person);
        nextTitle = titleByPersonId.get(nextPersonId) ?? null;
      }
    }

    const patch: Partial<AppUserRow> = {};
    if (nextPersonId !== user.person_id) patch.person_id = nextPersonId;
    if (nextFullName !== user.full_name) patch.full_name = nextFullName;
    if (nextTitle !== user.title) patch.title = nextTitle;

    if (Object.keys(patch).length === 0) continue;

    const { error } = await admin.from("app_user").update(patch).eq("id", user.id);
    if (error) continue;

    updatedUsers += 1;
    if (!user.person_id && nextPersonId) matchedByEmail += 1;
    if (nextPersonId && (nextFullName !== user.full_name || nextTitle !== user.title)) {
      refreshedProfiles += 1;
    }
  }

  return {
    scannedUsers: users.length,
    matchedByEmail,
    refreshedProfiles,
    updatedUsers,
  };
}
