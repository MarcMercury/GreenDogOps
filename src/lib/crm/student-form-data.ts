// Reference data for the Student CRM profile form: the clinic-location dropdown
// and the Mentor / Coordinator dropdowns (roster members flagged in the Schedule
// "Shift eligibility → Student" section). Kept separate from the CRM actions
// module so it can be imported by server components.
import { createClient } from "@/lib/supabase/server";
import type { CrmOption } from "./types";

export interface StudentFormOptions {
  locations: CrmOption[];
  mentors: CrmOption[];
  coordinators: CrmOption[];
}

interface EligibleRow {
  is_student_mentor: boolean | null;
  is_student_coordinator: boolean | null;
  person: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

function personName(p: EligibleRow["person"]): string | null {
  if (!p) return null;
  const name =
    p.full_name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Load the dropdown sources for the Student CRM profile:
 *  - clinic locations (active), value = location name so legacy free-text data maps,
 *  - Mentor / Coordinator candidates = roster members flagged in the Schedule
 *    "Shift eligibility → Student" section.
 */
export async function getStudentFormOptions(): Promise<StudentFormOptions> {
  const supabase = await createClient();
  const [locRes, eligRes] = await Promise.all([
    supabase
      .from("location")
      .select("name, display_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("sched_employee_setting")
      .select(
        "is_student_mentor, is_student_coordinator, person:person_id(full_name, first_name, last_name)",
      )
      .or("is_student_mentor.eq.true,is_student_coordinator.eq.true"),
  ]);

  const locations: CrmOption[] = (
    (locRes.data ?? []) as { name: string; display_name: string | null }[]
  )
    .filter((l) => l.name)
    .map((l) => {
      // Contacts store the friendly location name (e.g. "The Valley"), so use
      // the display name as the option value too — that keeps existing data
      // matching the dropdown instead of falling back to "… (current)".
      const label = l.display_name ?? l.name;
      return { value: label, label };
    });

  const mentors: CrmOption[] = [];
  const coordinators: CrmOption[] = [];
  for (const row of (eligRes.data ?? []) as unknown as EligibleRow[]) {
    const name = personName(row.person);
    if (!name) continue;
    if (row.is_student_mentor) mentors.push({ value: name, label: name });
    if (row.is_student_coordinator)
      coordinators.push({ value: name, label: name });
  }
  mentors.sort((a, b) => a.label.localeCompare(b.label));
  coordinators.sort((a, b) => a.label.localeCompare(b.label));

  return { locations, mentors, coordinators };
}
