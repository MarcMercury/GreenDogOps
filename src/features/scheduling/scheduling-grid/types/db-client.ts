import type { createClient } from "@/lib/supabase/server";

/**
 * The request-scoped Supabase client a Server Action opens once and threads
 * through every `db/` query it makes, so one action = one client (as before
 * the split, when each action called `createClient()` a single time).
 */
export type DbClient = Awaited<ReturnType<typeof createClient>>;
