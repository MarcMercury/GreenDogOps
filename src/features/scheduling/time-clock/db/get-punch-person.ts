import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Whose punch this is, or null when it no longer exists. */
export async function getPunchPerson(punchId: string): Promise<{ person_id: string } | null> {
  const { data } = await createAdminClient().from("time_punch").select("person_id").eq("id", punchId).maybeSingle();
  return (data as { person_id: string } | null) ?? null;
}
