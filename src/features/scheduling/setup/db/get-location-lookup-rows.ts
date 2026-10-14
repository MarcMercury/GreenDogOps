import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type LocLookupRow = {
  id: string;
  name: string | null;
  display_name: string | null;
  short_code: string | null;
};

/**
 * Request-cached reference lookup. Several HR-profile helpers each re-read
 * this small, stable table per request; `cache()` collapses the duplicates
 * into a single fetch per request without changing the returned data.
 */
export const getLocationLookupRows = cache(async (): Promise<LocLookupRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, display_name, short_code");
  return (data ?? []) as LocLookupRow[];
});
