import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AuthProvisionOutcome =
  | "created"
  | "exists"
  | "skipped_missing_email"
  | "skipped_status"
  | "skipped_inactive"
  | "skipped_missing_person";

export interface AuthProvisionResult {
  outcome: AuthProvisionOutcome;
  authId: string | null;
  email: string | null;
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

function normalizedEmail(v: string | null): string | null {
  if (!v) return null;
  const email = v.trim().toLowerCase();
  return email.length > 0 ? email : null;
}

function eligibleRosterStatus(status: string): boolean {
  return status === "employee" || status === "contractor";
}

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
 * Ensure a Supabase Auth account exists for this roster person.
 * Creates only for active employee/contractor records that have an email.
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
    return { outcome: "skipped_missing_person", authId: null, email: null };
  }

  const email = normalizedEmail(person.email);
  if (!email) {
    return { outcome: "skipped_missing_email", authId: null, email: null };
  }
  if (!person.is_active) {
    return { outcome: "skipped_inactive", authId: null, email };
  }
  if (!eligibleRosterStatus(person.status)) {
    return { outcome: "skipped_status", authId: null, email };
  }

  const existingAuthId = await findAuthUserIdByEmail(email);
  if (existingAuthId) {
    return { outcome: "exists", authId: existingAuthId, email };
  }

  const fullName =
    person.full_name ||
    [person.first_name, person.last_name].filter(Boolean).join(" ") ||
    null;
  const temporaryPassword = `${crypto.randomUUID()}aA1!`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });
  if (error) throw error;

  return { outcome: "created", authId: created.user?.id ?? null, email };
}
