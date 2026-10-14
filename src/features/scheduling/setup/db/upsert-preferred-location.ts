import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Writes `person_employment.preferred_location_id` — the single source of
 * truth shared with the HR roster.
 */
export async function upsertPreferredLocation(
  personId: string,
  locationId: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_employment")
    .upsert(
      { person_id: personId, preferred_location_id: locationId },
      { onConflict: "person_id" },
    );
  return { error: error?.message ?? null };
}
