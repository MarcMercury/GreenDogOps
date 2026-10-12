import { isTextableStatus, toE164 } from "./rules";

// ---------------------------------------------------------------------------
// The public opt-in page (/texts): match "last name + mobile number" to the
// people we may text. Pure, so the matching rules are unit-tested.
// ---------------------------------------------------------------------------

export interface OptInCandidate {
  id: string;
  status: string | null;
  last_name: string | null;
  phone_mobile: string | null;
}

/** "José O'Neil-Smith " → "joseoneilsmith"; letters only, accents removed. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Same last name, or one part of a hyphenated / two-word last name. */
export function lastNameMatches(stored: string | null | undefined, entered: string): boolean {
  const want = normalizeName(entered);
  if (!want) return false;
  if (normalizeName(stored) === want) return true;
  return (stored ?? "")
    .split(/[\s-]+/)
    .some((part) => normalizeName(part) === want);
}

/**
 * The people this opt-in applies to: textable status, the same US mobile number
 * (any stored format), and a matching last name. Duplicate profiles of the same
 * person all match; a capped list keeps a shared number from fanning out.
 */
export function matchOptInPeople(
  people: OptInCandidate[],
  input: { lastName: string; phone: string },
  max = 5,
): string[] {
  return people
    .filter((p) => isTextableStatus(p.status))
    .filter((p) => toE164(p.phone_mobile) === input.phone)
    .filter((p) => lastNameMatches(p.last_name, input.lastName))
    .slice(0, max)
    .map((p) => p.id);
}
