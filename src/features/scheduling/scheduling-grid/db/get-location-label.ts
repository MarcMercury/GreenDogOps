import "server-only";
import type { DbClient } from "@/features/scheduling/scheduling-grid/types/db-client";

/** A location's short code and name, for naming a generated guide. */
export async function getLocationLabel(
  supabase: DbClient,
  locationId: string,
): Promise<{ short_code: string | null; name: string | null } | null> {
  const { data } = await supabase
    .from("location")
    .select("short_code, name")
    .eq("id", locationId)
    .maybeSingle();
  return (data as { short_code: string | null; name: string | null } | null) ?? null;
}
