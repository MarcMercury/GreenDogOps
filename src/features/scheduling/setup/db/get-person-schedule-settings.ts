import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SchedEmployeeSetting } from "@/lib/schedule/types";
import type { PersonScheduleSettings } from "@/features/scheduling/setup/types/person-schedule-settings";
import { getLocationLookupRows } from "@/features/scheduling/setup/db/get-location-lookup-rows";
import { getRoleLookupRows } from "@/features/scheduling/setup/db/get-role-lookup-rows";

/** One employee's scheduling configuration, resolved to labels for the HR profile. */
export async function getPersonScheduleSettings(
  personId: string,
): Promise<PersonScheduleSettings> {
  const supabase = await createClient();
  const [setRes, locs, memRes, roles] = await Promise.all([
    supabase
      .from("sched_employee_setting")
      .select("*")
      .eq("person_id", personId)
      .maybeSingle(),
    getLocationLookupRows(),
    supabase.from("sched_role_member").select("role_id").eq("person_id", personId),
    getRoleLookupRows(),
  ]);

  const setting = (setRes.data as SchedEmployeeSetting | null) ?? null;
  const locById = new Map(locs.map((l) => [l.id, l]));
  const locName = (id: string | null): string | null => {
    if (!id) return null;
    const l = locById.get(id);
    return l?.display_name || l?.name || l?.short_code || null;
  };

  const roleById = new Map(roles.map((r) => [r.id, r.name]));
  const roleNames = ((memRes.data ?? []) as { role_id: string }[])
    .map((m) => roleById.get(m.role_id))
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));

  return {
    hasSetting: setting != null,
    isSchedulable: setting?.is_schedulable ?? false,
    weeklyTarget: setting?.weekly_shift_target ?? null,
    defaultLocationName: locName(setting?.default_location_id ?? null),
    eligibleLocationNames: (setting?.eligible_location_ids ?? [])
      .map((id) => locName(id))
      .filter((n): n is string => Boolean(n)),
    availableDays: setting?.available_days ?? [],
    roleNames,
    notes: setting?.notes ?? null,
  };
}
