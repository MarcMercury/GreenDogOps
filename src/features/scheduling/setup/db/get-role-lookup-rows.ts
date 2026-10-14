import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Request-cached `sched_role` id → name lookup (see `getLocationLookupRows`). */
export const getRoleLookupRows = cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase.from("sched_role").select("id, name");
    return (data ?? []) as { id: string; name: string }[];
  },
);
