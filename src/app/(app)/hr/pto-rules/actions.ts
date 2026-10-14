"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, recordAudit } from "@/lib/auth/session";
import { canAccessModule, canViewAllCompensation } from "@/lib/auth/permissions";
import { buildRules, RULES_SIGNOFF_ACTION, rulesVersion } from "@/lib/pto/rules";

/**
 * Payroll / HR sign-off of the current PTO & Timekeeping Rules (go-live item
 * 26). Recorded in the audit log against the rules' fingerprint, so any later
 * change to a rule or example needs a fresh sign-off.
 */
export async function signOffRules(version: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "You are not signed in (or this is a read-only preview)." };
  if (!canAccessModule(current.appUser, "hr") || !canViewAllCompensation(current.appUser.role)) {
    return { ok: false, error: "Only Owner, Admin, Executive or HR / Manager can sign off the rules." };
  }
  const now = rulesVersion(buildRules());
  if (version !== now) return { ok: false, error: "The rules changed since you opened the page. Reload and review them again." };
  await recordAudit({
    actorId: current.authId,
    actorEmail: current.email,
    action: RULES_SIGNOFF_ACTION,
    entity: "timekeeping_rules",
    entityId: now,
    summary: `Signed off PTO & Timekeeping Rules version ${now}`,
    metadata: { version: now, role: current.appUser.role, name: current.appUser.full_name ?? null },
  });
  revalidatePath("/hr/pto-rules");
  return { ok: true, message: "Signed off." };
}
