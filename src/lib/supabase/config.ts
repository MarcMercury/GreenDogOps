/**
 * Central Supabase configuration.
 *
 * Green Dog Ops SHARES a Supabase project with EmployeeGMGDD, but all of its
 * tables live in a dedicated Postgres schema (default: "greendogops") so the two
 * apps never collide. EmployeeGMGDD owns the `public` schema; we never touch it.
 *
 * Every Supabase client in this app is created with `db.schema = DB_SCHEMA`, so
 * `from('employees')` resolves to `greendogops.employees`, not `public.employees`.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Dedicated, isolated schema for all Green Dog Ops data. */
export const DB_SCHEMA = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ?? "greendogops";

export function assertSupabaseEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).",
    );
  }
}
