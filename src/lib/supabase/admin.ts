import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { DB_SCHEMA, SUPABASE_URL } from "./config";

/**
 * Privileged, service-role Supabase client scoped to the `greendogops` schema.
 *
 * SERVER-ONLY. This client uses the SUPABASE_SERVICE_ROLE_KEY, which BYPASSES
 * Row Level Security. Never import it into Client Components, and never expose
 * its results directly to unauthenticated callers. Use it only for trusted
 * server work: bulk imports, cron jobs, and AI auto-update routines.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error(
      "Missing admin Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY (server-only) in .env.local / Vercel.",
    );
  }

  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    db: { schema: DB_SCHEMA },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
