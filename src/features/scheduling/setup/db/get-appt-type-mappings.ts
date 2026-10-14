import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import type { ApptReportTrack, ApptTypeDeptMapping } from "@/lib/schedule/types";

/**
 * Appointment type → department catalog for the Planning Guide Setup tab.
 * Merges the persisted map rows with every appointment type observed in the
 * booked-appointment snapshot (so newly-seen types surface even before they are
 * assigned), ordered by real booking popularity.
 */
export async function getApptTypeMappings(): Promise<ApptTypeDeptMapping[]> {
  const supabase = await createClient();
  // appt_type_observed_counts is SECURITY DEFINER, so it runs with the service
  // role (0238); this loader checks Scheduling access itself because the page
  // fetches it in parallel with its own auth lookup.
  const current = await getCurrentUser({ allowPreview: true });
  const mayCount = !!current && canAccessModule(current.appUser, "schedule");
  const [mapRes, countRes] = await Promise.all([
    supabase
      .from("ezyvet_appt_type_dept_map")
      .select("appt_type, department_id, is_ignored, report_track"),
    mayCount
      ? createAdminClient().rpc("appt_type_observed_counts")
      : Promise.resolve({ data: [] }),
  ]);

  const counts = new Map<string, number>();
  for (const r of (countRes.data ?? []) as {
    appt_type: string;
    observed_count: number;
  }[]) {
    counts.set(r.appt_type, Number(r.observed_count) || 0);
  }

  const byType = new Map<string, ApptTypeDeptMapping>();
  for (const r of (mapRes.data ?? []) as {
    appt_type: string;
    department_id: string | null;
    is_ignored: boolean;
    report_track: ApptReportTrack | null;
  }[]) {
    byType.set(r.appt_type, {
      appt_type: r.appt_type,
      department_id: r.department_id,
      is_ignored: r.is_ignored,
      report_track: r.report_track,
      observed_count: counts.get(r.appt_type) ?? 0,
    });
  }
  // Include observed types that don't yet have a persisted mapping row.
  for (const [appt_type, observed_count] of counts) {
    if (!byType.has(appt_type)) {
      byType.set(appt_type, {
        appt_type,
        department_id: null,
        is_ignored: false,
        report_track: null,
        observed_count,
      });
    }
  }

  return [...byType.values()].sort(
    (a, b) =>
      b.observed_count - a.observed_count ||
      a.appt_type.localeCompare(b.appt_type),
  );
}
