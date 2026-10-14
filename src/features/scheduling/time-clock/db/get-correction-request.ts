import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** The employee and kind of a correction request, or null when it is gone. */
export async function getCorrectionRequest(
  requestId: string,
): Promise<{ person_id: string; kind: string } | null> {
  const { data } = await createAdminClient()
    .from("time_correction_request")
    .select("person_id, kind")
    .eq("id", requestId)
    .maybeSingle();
  return (data as { person_id: string; kind: string } | null) ?? null;
}
