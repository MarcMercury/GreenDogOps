import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limit backed by greendogops.rate_limit_hit (migration
 * 0227). Returns true when the request may proceed.
 *
 * Fails OPEN on infrastructure errors: a database hiccup must not lock staff
 * out of sign-in or drop a candidate's application. Supabase Auth applies its
 * own limits underneath.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_key: key.slice(0, 200),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] check failed:", error.message);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.error("[rate-limit] check failed:", err);
    return true;
  }
}

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

/** Best-effort client IP and user agent for rate limiting and audit entries. */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || h.get("x-real-ip") || "unknown";
    const ua = h.get("user-agent");
    return { ip, userAgent: ua ? ua.slice(0, 300) : null };
  } catch {
    return { ip: "unknown", userAgent: null };
  }
}

export const TOO_MANY_MESSAGE =
  "Too many attempts from your network. Please wait a few minutes and try again.";

/** Per-IP guard for public (unauthenticated) form submissions. */
export async function allowPublicSubmission(
  form: string,
  limit = 30,
  windowSeconds = 600,
): Promise<boolean> {
  const { ip } = await requestMeta();
  return rateLimit(`public:${form}:${ip}`, limit, windowSeconds);
}
