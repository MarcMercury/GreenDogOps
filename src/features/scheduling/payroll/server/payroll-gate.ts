import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { canApproveTime } from "@/lib/auth/permissions";

export type PayrollGate = { ok: true; current: CurrentUser } | { ok: false; error: string };

/**
 * Who may run a payroll action (checklist item 21, D9): Owner, Admin,
 * Executive and HR / Manager. A "View as" preview has no writable session, so
 * it is refused the same way as a signed-out request.
 */
export async function gate(): Promise<PayrollGate> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canApproveTime(current.appUser)) {
    return { ok: false, error: "Only Owners, Admins, Executives and HR / Managers can approve timecards." };
  }
  return { ok: true, current };
}
