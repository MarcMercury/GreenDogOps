import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Whether a `person` row with this id exists. */
export async function personExists(personId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("person").select("id").eq("id", personId).maybeSingle();
  return !!data;
}
