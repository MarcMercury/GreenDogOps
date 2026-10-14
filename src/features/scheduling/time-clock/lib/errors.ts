/** Error codes returned by the approver RPCs → what the approver sees. */
export const ERRORS: Record<string, string> = {
  note_required: "Please add a note explaining the decision.",
  already_reviewed: "Someone has already decided this punch.",
  not_pending: "This has already been handled.",
  not_found: "Not found — it may have been removed.",
  replace_target_required: "Pick which punch the corrected time replaces.",
  replace_target_invalid: "That punch doesn't belong to this employee.",
  already_voided: "That punch has already been replaced.",
  future_time: "The requested time is in the future.",
  invalid_decision: "Unknown decision.",
};
