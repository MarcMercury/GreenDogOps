import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Set a person's Mentor / Coordinator flags on `sched_employee_setting`. */
export async function upsertStudentFlags(
  personId: string,
  isMentor: boolean,
  isCoordinator: boolean,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("sched_employee_setting").upsert(
    {
      person_id: personId,
      is_student_mentor: isMentor,
      is_student_coordinator: isCoordinator,
    },
    { onConflict: "person_id" },
  );
  return { error: error?.message ?? null };
}
