import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/session";
import {
  AUTO_LOGIN_ROLE,
  findExistingLogin,
  isRosterLoginStatus,
  normalizedLoginEmail,
  type ExistingLogin,
} from "@/lib/auth/login-provision";

export type AuthProvisionOutcome =
  | "created"
  | "exists"
  | "skipped_missing_email"
  | "skipped_status"
  | "skipped_inactive"
  | "skipped_missing_person";

/** What happened to the person's Green Dog Ops login (`app_user`). */
export type AppUserProvisionOutcome = "created" | "exists" | "skipped" | "failed";

export interface AuthProvisionResult {
  outcome: AuthProvisionOutcome;
  authId: string | null;
  email: string | null;
  appUser: AppUserProvisionOutcome;
  appUserError?: string;
}

type PersonAuthSeed = {
  id: string;
  status: string;
  is_active: boolean;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

/** Find an auth user id by email via paged Admin API lookup. */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

/**
 * Give the person an active Green Dog Ops login (`app_user`, role staff) when
 * none covers them yet. Insert-only: an existing login — including one an
 * admin deactivated — is left exactly as it is. Sends no email; inviting
 * stays a separate, explicit step.
 */
async function ensureAppUserForPerson(
  person: PersonAuthSeed,
  authId: string,
  email: string,
  fullName: string | null,
): Promise<{ appUser: AppUserProvisionOutcome; appUserError?: string }> {
  const admin = createAdminClient();
  // app_user is the staff allow-list (~100 rows); read it whole and match with the tested rule.
  const { data: existing, error: lookupErr } = await admin
    .from("app_user")
    .select("id, email, person_id")
    .limit(5000);
  if (lookupErr) return { appUser: "failed", appUserError: lookupErr.message };
  if (findExistingLogin((existing ?? []) as ExistingLogin[], { authId, personId: person.id, email })) {
    return { appUser: "exists" };
  }

  const { data: emp } = await admin
    .from("person_employment")
    .select("adp_job_title, offer_title")
    .eq("person_id", person.id)
    .maybeSingle();
  const job = emp as { adp_job_title: string | null; offer_title: string | null } | null;
  const title = job?.adp_job_title ?? job?.offer_title ?? null;

  const { data: rows, error } = await admin
    .from("app_user")
    .upsert(
      {
        id: authId,
        email,
        full_name: fullName,
        title,
        role: AUTO_LOGIN_ROLE,
        is_active: true,
        person_id: person.id,
        notes: "Provisioned automatically when they joined the roster. No invite sent.",
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { appUser: "failed", appUserError: error.message };
  if (!rows?.length) return { appUser: "exists" };

  await recordAudit({
    actorId: null,
    actorEmail: "system:auto-provision",
    action: "user.access_granted",
    entity: "app_user",
    entityId: authId,
    summary: `Granted ${email} access as ${AUTO_LOGIN_ROLE} (joined the roster as ${person.status}, no invite sent)`,
    metadata: { person_id: person.id, auto: true },
  });
  return { appUser: "created" };
}

/**
 * Ensure an active employee/contractor with an email can sign in: a Supabase
 * Auth account (shared with EmployeeGMGDD) plus a Green Dog Ops `app_user` row
 * at role staff. A failure to create the `app_user` row is reported in the
 * result rather than thrown, so the HR/ATS save that triggered it still lands;
 * the daily roster sync retries it.
 */
export async function ensureAuthUserForPerson(personId: string): Promise<AuthProvisionResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("person")
    .select("id, status, is_active, email, full_name, first_name, last_name")
    .eq("id", personId)
    .maybeSingle();

  const person = data as PersonAuthSeed | null;
  if (!person) {
    return { outcome: "skipped_missing_person", authId: null, email: null, appUser: "skipped" };
  }

  const email = normalizedLoginEmail(person.email);
  if (!email) {
    return { outcome: "skipped_missing_email", authId: null, email: null, appUser: "skipped" };
  }
  if (!person.is_active) {
    return { outcome: "skipped_inactive", authId: null, email, appUser: "skipped" };
  }
  if (!isRosterLoginStatus(person.status)) {
    return { outcome: "skipped_status", authId: null, email, appUser: "skipped" };
  }

  const fullName =
    person.full_name ||
    [person.first_name, person.last_name].filter(Boolean).join(" ") ||
    null;

  let outcome: AuthProvisionOutcome;
  let authId = await findAuthUserIdByEmail(email);
  if (authId) {
    outcome = "exists";
  } else {
    const temporaryPassword = `${crypto.randomUUID()}aA1!`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    if (error) throw error;
    authId = created.user?.id ?? null;
    outcome = "created";
  }

  if (!authId) {
    return { outcome, authId, email, appUser: "failed", appUserError: "auth user has no id" };
  }
  const login = await ensureAppUserForPerson(person, authId, email, fullName);
  if (login.appUser === "failed") {
    console.error(`[auto-provision] app_user for person ${person.id} failed: ${login.appUserError}`);
  }
  return { outcome, authId, email, ...login };
}
