// ---------------------------------------------------------------------------
// Jobs ↔ candidates. A candidate is linked to one job
// (person_recruiting.target_position_id); the free-text target_title /
// job_location stay in sync with it so imports, Slack posts and legacy
// candidates that were never linked still read sensibly.
//
// Pure functions so the matching rules can be unit-tested and reused by the
// intake poller, the import path and the server actions.
// ---------------------------------------------------------------------------

import { normalizePositionTitle } from "./normalize";
import { positionLabel, type PersonRecruiting, type PositionRow } from "./types";

type MatchableJob = Pick<PositionRow, "id" | "title" | "location" | "status">;

function key(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return s === "" ? null : s;
}

function titleKey(v: string | null | undefined): string | null {
  return key(normalizePositionTitle(v));
}

/**
 * The open job an application is clearly for: same role title (after the
 * canonical title normalization) and same clinic. An application with no
 * clinic, or a job with no clinic, matches on title alone. Returns null when
 * nothing matches or more than one job does (e.g. "CSR" with CSR jobs open at
 * two clinics) — a recruiter picks the job in the Review Queue instead.
 */
export function matchOpenJob<J extends MatchableJob>(
  jobs: readonly J[],
  title: string | null | undefined,
  location: string | null | undefined,
): J | null {
  const t = titleKey(title);
  if (!t) return null;
  const loc = key(location);
  const hits = jobs.filter((j) => {
    if (j.status !== "open") return false;
    if (titleKey(j.title) !== t) return false;
    const jobLoc = key(j.location);
    return loc === null || jobLoc === null || jobLoc === loc;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** The person_recruiting fields that follow a job assignment. */
export function jobRecruitingFields(
  job: Pick<PositionRow, "id" | "title" | "location"> | null,
): Pick<PersonRecruiting, "target_position_id"> &
  Partial<Pick<PersonRecruiting, "target_title" | "job_location">> {
  if (!job) return { target_position_id: null };
  return {
    target_position_id: job.id,
    target_title: normalizePositionTitle(job.title),
    ...(job.location ? { job_location: job.location } : {}),
  };
}

/**
 * How a candidate's job reads in lists and Slack: the linked job's label when
 * linked ("CSR — Van Nuys"), else the free-text title + clinic they applied with.
 */
export function candidateJobLabel(
  rec: Pick<PersonRecruiting, "target_position_id" | "target_title" | "job_location"> | null | undefined,
  jobsById?: ReadonlyMap<string, Pick<PositionRow, "title" | "location">>,
): string | null {
  if (!rec) return null;
  const job = rec.target_position_id ? jobsById?.get(rec.target_position_id) : undefined;
  if (job) return positionLabel(job);
  if (!rec.target_title) return null;
  return positionLabel({ title: rec.target_title, location: rec.job_location });
}

/** A candidate hired into a job (now on the roster, still linked to the job). */
export interface JobHire {
  position_id: string;
  person_id: string;
  name: string;
  hire_date: string | null;
}

/** Hires that count toward a job's current run of openings (since it was last opened). */
export function hiresSinceOpened(
  hires: readonly JobHire[],
  job: Pick<PositionRow, "id" | "opened_at">,
): JobHire[] {
  const since = job.opened_at.slice(0, 10);
  return hires.filter(
    (h) => h.position_id === job.id && (h.hire_date === null || h.hire_date >= since),
  );
}
