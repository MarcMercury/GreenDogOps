// Shared types for the ATS candidate import flow (list import + resume parse).
// Used by both the server actions and the client import dialog, so this module
// must stay free of "server-only" imports.

/**
 * A candidate parsed from an uploaded list row or a resume, mapped onto the
 * fields the recruiting form already understands. Every field is optional —
 * anything we cannot confidently extract is left null for manual entry.
 */
export interface ParsedCandidate {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  /** Position / role they are applying for (person_recruiting.target_title). */
  target_title: string | null;
  pipeline: string | null;
  stage: string | null;
  source: string | null;
  opportunity_type: string | null;
  score: number | null;
  /** Free-form summary (work history highlights, etc.). */
  notes: string | null;
  status_notes: string | null;
}

export function emptyCandidate(): ParsedCandidate {
  return {
    first_name: null,
    last_name: null,
    full_name: null,
    email: null,
    phone_mobile: null,
    target_title: null,
    pipeline: null,
    stage: null,
    source: null,
    opportunity_type: null,
    score: null,
    notes: null,
    status_notes: null,
  };
}

/** True when the candidate has at least a name or an email to key on. */
export function candidateHasIdentity(c: ParsedCandidate): boolean {
  return Boolean(
    (c.full_name && c.full_name.trim()) ||
      (c.first_name && c.first_name.trim()) ||
      (c.last_name && c.last_name.trim()) ||
      (c.email && c.email.trim()),
  );
}

export type ParseListResult =
  | { ok: true; candidates: ParsedCandidate[]; warnings: string[] }
  | { ok: false; error: string };

export type ParseResumeResult =
  | { ok: true; candidate: ParsedCandidate }
  | { ok: false; error: string };

export type CreateCandidatesResult =
  | { ok: true; created: number; failed: number; errors: string[] }
  | { ok: false; error: string };
