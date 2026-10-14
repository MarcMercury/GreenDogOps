import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { canApproveTime } from "@/lib/auth/permissions";
import type { ApproverResult } from "@/features/scheduling/time-clock/types/approver-result";

// Approver actions (go-live plan D9: Owner, Admin, Executive, HR / Manager).
// The database functions are atomic and idempotent; this layer checks the
// role, refuses approvers acting on their own time, and audits every change.

export async function approverGate(): Promise<{ ok: true; current: CurrentUser } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canApproveTime(current.appUser)) {
    return { ok: false, error: "Only Owners, Admins, Executives and HR / Managers can change timecards." };
  }
  return { ok: true, current };
}

export function notOwnTime(current: CurrentUser, personId: string): ApproverResult | null {
  return current.appUser.person_id && current.appUser.person_id === personId
    ? { ok: false, error: "You can't approve or change your own time. Ask another approver." }
    : null;
}

export const reviewerName = (current: CurrentUser) => current.appUser.full_name || current.email;
