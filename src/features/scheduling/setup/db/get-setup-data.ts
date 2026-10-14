import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  SchedDepartment,
  SchedEmployeeSetting,
  SchedPerson,
  SchedRole,
  SchedRoleMember,
  SchedShiftTemplate,
} from "@/lib/schedule/types";
import { PERSON_COLS } from "@/features/scheduling/shared/db/person-columns";
import type { SetupData } from "@/features/scheduling/setup/types/setup-data";
import { getLocations } from "@/features/scheduling/setup/db/get-locations";

/** Everything the Setup screens need in one shot. */
export async function getSetupData(): Promise<SetupData> {
  const supabase = await createClient();
  const [deptRes, roleRes, tplRes, memRes, setRes, peopleRes, empRes, locations] =
    await Promise.all([
      supabase
        .from("sched_department")
        .select("*")
        .order("sort_order")
        .order("name"),
      supabase.from("sched_role").select("*").order("sort_order").order("name"),
      supabase.from("sched_shift_template").select("*").order("sort_order"),
      supabase.from("sched_role_member").select("*"),
      supabase.from("sched_employee_setting").select("*"),
      supabase
        .from("person")
        .select(PERSON_COLS)
        .in("status", ["employee", "contractor"])
        .order("last_name"),
      supabase
        .from("person_employment")
        .select("person_id, preferred_location_id, schedule_type"),
      getLocations(),
    ]);

  const employmentByPerson = new Map(
    (
      (empRes.data ?? []) as Array<{
        person_id: string;
        preferred_location_id: string | null;
        schedule_type: string | null;
      }>
    ).map((e) => [e.person_id, e]),
  );

  const people = ((peopleRes.data ?? []) as SchedPerson[]).map((p) => ({
    ...p,
    preferred_location_id:
      employmentByPerson.get(p.id)?.preferred_location_id ?? null,
    schedule_type: employmentByPerson.get(p.id)?.schedule_type ?? null,
  }));

  return {
    departments: (deptRes.data ?? []) as SchedDepartment[],
    roles: (roleRes.data ?? []) as SchedRole[],
    templates: (tplRes.data ?? []) as SchedShiftTemplate[],
    members: (memRes.data ?? []) as SchedRoleMember[],
    settings: (setRes.data ?? []) as SchedEmployeeSetting[],
    people,
    locations,
  };
}
