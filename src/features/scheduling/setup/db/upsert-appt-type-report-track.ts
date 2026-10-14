import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ApptReportTrack } from "@/lib/schedule/types";

/** Set (or clear, with null) the Slack-report lane of an appointment type. */
export async function upsertApptTypeReportTrack(
  apptType: string,
  reportTrack: ApptReportTrack | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ezyvet_appt_type_dept_map")
    .upsert(
      { appt_type: apptType, report_track: reportTrack },
      { onConflict: "appt_type" },
    );
  return { error: error?.message ?? null };
}
