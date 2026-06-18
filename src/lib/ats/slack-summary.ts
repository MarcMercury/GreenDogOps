// Slack-friendly plain-text summaries for the ATS.
//
// These build copy-and-paste blocks that read cleanly when dropped into a Slack
// message. Slack renders *single asterisks* as bold, so headings use that.

import type { CandidateRow, PersonInterview } from "./types";
import {
  INTERVIEW_TYPE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_RECOMMENDATION_LABELS,
} from "./types";
import { opportunityShortLabel } from "@/lib/shared/opportunity-types";

function candidateName(row: CandidateRow): string {
  return (
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Candidate"
  );
}

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Build "Label: value" lines, skipping anything empty.
function lines(pairs: Array<[string, string | null | undefined]>): string[] {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([label, v]) => `${label}: ${String(v).trim()}`);
}

/** A new-candidate summary to post when a candidate is added to the pipeline. */
export function buildCandidateSummary(row: CandidateRow): string {
  const rec = row.person_recruiting;
  const name = candidateName(row);

  const out: string[] = [`*🆕 New Candidate — ${name}*`];

  out.push(
    ...lines([
      ["Position", rec?.target_title],
      ["Opportunity", opportunityShortLabel(row.opportunity_type) || null],
      ["Pipeline", rec?.pipeline],
      ["Stage", rec?.stage],
      ["Source", rec?.source],
      ["Email", row.email],
      ["Phone", row.phone_mobile ?? row.phone_home ?? row.phone_other],
      ["Interview date", fmtDate(rec?.interview_date)],
    ]),
  );

  const notes = rec?.notes ?? row.notes;
  if (notes && notes.trim() !== "") {
    out.push("", `Notes: ${notes.trim()}`);
  }

  return out.join("\n");
}

/** An interview summary to share with the team after an interview. */
export function buildInterviewSummary(
  row: CandidateRow,
  interview: PersonInterview,
): string {
  const rec = row.person_recruiting;
  const name = candidateName(row);
  const typeLabel = interview.interview_type
    ? (INTERVIEW_TYPE_LABELS[interview.interview_type] ??
      interview.interview_type)
    : "Interview";

  const out: string[] = [`*🗓️ Interview Summary — ${name}*`];

  out.push(
    ...lines([
      ["Position", rec?.target_title],
      ["Type", typeLabel],
      ["Date", fmtDate(interview.interview_date)],
      ["Interviewer", interview.interviewer],
      ["Location", interview.location],
      [
        "Status",
        INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status,
      ],
      ["Grade", interview.overall_grade],
      [
        "Recommendation",
        interview.recommendation
          ? (INTERVIEW_RECOMMENDATION_LABELS[interview.recommendation] ??
            interview.recommendation)
          : null,
      ],
    ]),
  );

  if (interview.summary && interview.summary.trim() !== "") {
    out.push("", `*Summary:*`, interview.summary.trim());
  }

  const answered = (interview.responses ?? []).filter(
    (r) => r.answer && r.answer.trim() !== "",
  );
  if (answered.length > 0) {
    out.push("", `*Responses:*`);
    for (const r of answered) {
      out.push(`• ${r.question}`, `   ${r.answer!.trim()}`);
    }
  }

  return out.join("\n");
}
