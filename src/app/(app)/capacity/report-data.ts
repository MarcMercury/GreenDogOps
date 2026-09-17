import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ReportCapacityOverride,
  ReportCapacityTarget,
} from "./report-targets";

/**
 * Slot counts behind the upcoming-appointments Slack post: the full recurring
 * weekly pattern, plus overrides from today onwards (past ones are history).
 */
export async function getReportCapacity(): Promise<{
  targets: ReportCapacityTarget[];
  overrides: ReportCapacityOverride[];
}> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [targetRes, overrideRes] = await Promise.all([
    supabase
      .from("report_capacity_target")
      .select("id, location_id, track, weekday, capacity"),
    supabase
      .from("report_capacity_override")
      .select("id, location_id, track, appt_date, capacity, note")
      .gte("appt_date", today)
      .order("appt_date"),
  ]);

  return {
    targets: (targetRes.data ?? []) as ReportCapacityTarget[],
    overrides: (overrideRes.data ?? []) as ReportCapacityOverride[],
  };
}
