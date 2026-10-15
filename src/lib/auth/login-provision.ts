// Pure rules for giving roster people a Green Dog Ops login automatically.
// Server code lives in auto-provision.ts; keep this file import-free so tests can load it.

/** The role a new hire's login gets. Staff is the employee role (0239). */
export const AUTO_LOGIN_ROLE = "staff";

/** Upper bound on logins the daily backstop creates in one run. */
export const AUTO_LOGIN_BATCH_LIMIT = 25;

export interface LoginCandidate {
  id: string;
  status: string;
  is_active: boolean;
  email: string | null;
}

export interface ExistingLogin {
  id: string;
  email: string | null;
  person_id: string | null;
}

export function normalizedLoginEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const email = v.trim().toLowerCase();
  return email.length > 0 ? email : null;
}

export function isRosterLoginStatus(status: string): boolean {
  return status === "employee" || status === "contractor";
}

/** An active employee/contractor with an email gets a login. */
export function eligibleForAutoLogin(p: LoginCandidate): boolean {
  return p.is_active && isRosterLoginStatus(p.status) && normalizedLoginEmail(p.email) !== null;
}

/**
 * The login that already covers this person, if any — matched by auth id,
 * person link or email. Auto-provisioning never touches an existing row, so a
 * login an admin deactivated stays deactivated.
 */
export function findExistingLogin(
  logins: readonly ExistingLogin[],
  target: { authId: string | null; personId: string; email: string | null },
): ExistingLogin | null {
  const email = normalizedLoginEmail(target.email);
  return (
    logins.find(
      (l) =>
        (target.authId !== null && l.id === target.authId) ||
        l.person_id === target.personId ||
        (email !== null && normalizedLoginEmail(l.email) === email),
    ) ?? null
  );
}

/** Eligible people the daily backstop should provision, oldest-first order kept. */
export function peopleMissingLogins<P extends LoginCandidate>(
  people: readonly P[],
  logins: readonly ExistingLogin[],
): P[] {
  const byPerson = new Set(logins.map((l) => l.person_id).filter((v): v is string => !!v));
  const byEmail = new Set(
    logins.map((l) => normalizedLoginEmail(l.email)).filter((v): v is string => !!v),
  );
  const emailCounts = new Map<string, number>();
  for (const p of people) {
    const e = normalizedLoginEmail(p.email);
    if (e && eligibleForAutoLogin(p)) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
  }
  return people.filter((p) => {
    if (!eligibleForAutoLogin(p)) return false;
    const email = normalizedLoginEmail(p.email)!;
    // Two roster people sharing one email is a data problem for HR, not a login.
    if ((emailCounts.get(email) ?? 0) > 1) return false;
    return !byPerson.has(p.id) && !byEmail.has(email);
  });
}
