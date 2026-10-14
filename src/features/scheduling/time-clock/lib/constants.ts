/** How far back an approver may add a missing punch. */
export const ADD_PUNCH_WINDOW_DAYS = 45;

/** Correction-request kinds as shown in the queue. */
export const KIND_LABEL = {
  missing_punch: "Forgot to punch",
  wrong_time: "Wrong time",
  other: "Something else",
} as const;
