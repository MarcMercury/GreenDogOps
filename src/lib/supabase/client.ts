import { createBrowserClient } from "@supabase/ssr";
import { DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Browser-side Supabase client, scoped to the isolated `greendogops` schema.
 * Use inside Client Components.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: DB_SCHEMA },
  });
}
