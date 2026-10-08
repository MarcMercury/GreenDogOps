import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

export {
  MFA_REQUIRED_ROLES,
  aalFromAccessToken,
  mfaRequirement,
  roleRequiresMfa,
  type MfaRequirement,
} from "./mfa-policy";

/** Admin → Settings → "Require two-step verification" (cached per request). */
export const isMfaEnforced = cache(async (): Promise<boolean> => {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_setting")
      .select("value")
      .eq("key", "security.require_mfa")
      .maybeSingle();
    return (data as { value: unknown } | null)?.value === true;
  } catch {
    return false;
  }
});
