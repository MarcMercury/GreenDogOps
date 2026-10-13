// Meal-period waivers (go-live plan D14, §J) — pure.

export const MEAL_WAIVER_KINDS = ["six_hour", "second_meal"] as const;
export type MealWaiverKind = (typeof MEAL_WAIVER_KINDS)[number];

/** The policy documents seeded by migration 0242 (Resources ▸ HR). */
export const MEAL_WAIVER_DOCUMENT_IDS: Record<MealWaiverKind, string> = {
  six_hour: "7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6001",
  second_meal: "7a1f0c2e-6d1b-4c55-9f0a-0e5a3c9b6002",
};

export const MEAL_WAIVER_LABELS: Record<MealWaiverKind, string> = {
  six_hour: "Meal period waiver (workdays of 6 hours or less)",
  second_meal: "Second meal period waiver (workdays of 12 hours or less)",
};

/** app_setting that turns the waivers on in My Time (off until HR approves the wording). */
export const MEAL_WAIVERS_LIVE_SETTING = "timeclock.meal_waivers_live";

export function isMealWaiverKind(v: unknown): v is MealWaiverKind {
  return typeof v === "string" && (MEAL_WAIVER_KINDS as readonly string[]).includes(v);
}

export interface WaiverRecord {
  kind: MealWaiverKind;
  signed_at: string;
  revoked_at: string | null;
}

/**
 * Was this kind of waiver in force at `at`? Signed at or before it and not
 * revoked by then. Mirrors greendogops.meal_waiver_in_force() (0242).
 */
export function waiverInForce(records: readonly WaiverRecord[], kind: MealWaiverKind, at: Date): boolean {
  const t = at.getTime();
  return records.some(
    (r) =>
      r.kind === kind &&
      new Date(r.signed_at).getTime() <= t &&
      (r.revoked_at === null || new Date(r.revoked_at).getTime() > t),
  );
}

/** The active (unrevoked) waiver of a kind, if any. */
export function activeWaiver<T extends WaiverRecord>(records: readonly T[], kind: MealWaiverKind): T | null {
  return records.find((r) => r.kind === kind && r.revoked_at === null) ?? null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * The typed signature must be the employee's name: their first (or preferred)
 * and last name, in that order, ignoring case, accents, punctuation and any
 * middle names.
 */
export function signatureMatches(
  typed: string,
  person: { first_name: string | null; last_name: string | null; preferred_name: string | null },
): boolean {
  const words = normalize(typed).split(" ").filter(Boolean);
  const last = normalize(person.last_name ?? "");
  if (words.length < 2 || !last) return false;
  const firsts = [person.first_name, person.preferred_name].map((n) => normalize(n ?? "")).filter(Boolean);
  const typedFirst = words[0];
  const typedRest = words.slice(1).join(" ");
  return firsts.some((f) => f.split(" ")[0] === typedFirst) && (typedRest === last || typedRest.endsWith(` ${last}`));
}
