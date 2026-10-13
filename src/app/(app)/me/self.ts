import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import { resolveSelf, type SelfResolution } from "@/lib/timeclock/server";

/**
 * The signed-in person for a /me page render (cached per request). Pure reads,
 * so it also works during an Owner's "View as" preview, showing the previewed
 * person's own time — never anyone chosen by the URL.
 */
export const loadSelf = cache(async (): Promise<SelfResolution | { ok: false; reason: "no_access" }> => {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canAccessModule(current.appUser, "my_time")) return { ok: false, reason: "no_access" };
  return resolveSelf(current.appUser);
});

export function selfProblemMessage(reason: "no_profile" | "not_employee" | "no_access"): string {
  switch (reason) {
    case "no_profile":
      return "Your login isn't linked to an HR profile yet, so there is no time clock to show. Ask HR to link your account.";
    case "not_employee":
      return "The time clock is for active employees and contractors.";
    default:
      return "You don't have access to My Time.";
  }
}
