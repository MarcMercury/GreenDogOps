// ATS → HR hire: which `person_employment` fields a hire fills in from the
// recruiting record. The person row, recruiting history, interviews and
// documents already stay on the same `person`, so only the employment row needs
// seeding. HR-entered values always win — a field is only filled when blank.

import { normalizeJobTitle } from "../hr/job-titles";

export interface EmploymentOnFile {
  hire_date: string | null;
  position_id: string | null;
  offer_title: string | null;
  location_id: string | null;
  preferred_location_id: string | null;
}

export interface RecruitingOnHire {
  pipeline: string | null;
  target_position_id: string | null;
  target_title: string | null;
  job_location: string | null;
}

export interface HireJob {
  title: string;
  location: string | null;
}

export interface ClinicLocation {
  id: string;
  name: string;
  display_name: string | null;
}

const key = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim().toLowerCase() || null;

/** The clinic a job/recruiting location names ("Van Nuys" or "The Valley"), if any. */
export function matchClinicLocation(
  label: string | null | undefined,
  locations: readonly ClinicLocation[],
): string | null {
  const k = key(label);
  if (!k) return null;
  const hit = locations.find((l) => key(l.name) === k || key(l.display_name) === k);
  return hit?.id ?? null;
}

export function employmentSeedOnHire(args: {
  personId: string;
  today: string;
  existing: EmploymentOnFile | null;
  recruiting: RecruitingOnHire | null;
  job: HireJob | null;
  locations: readonly ClinicLocation[];
}) {
  const { personId, today, existing, recruiting, job, locations } = args;
  const clinic = matchClinicLocation(job?.location ?? recruiting?.job_location, locations);
  // A promoted student's target_title is their program name, not a job title.
  const appliedTitle = recruiting?.pipeline === "Students" ? null : recruiting?.target_title;
  return {
    person_id: personId,
    hire_date: existing?.hire_date ?? today,
    position_id: existing?.position_id ?? recruiting?.target_position_id ?? null,
    offer_title:
      existing?.offer_title ?? normalizeJobTitle(job?.title ?? appliedTitle ?? null),
    location_id: existing?.location_id ?? clinic,
    preferred_location_id: existing?.preferred_location_id ?? clinic,
  };
}
