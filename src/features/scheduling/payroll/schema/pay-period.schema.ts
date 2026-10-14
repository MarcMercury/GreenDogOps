import { requiredDate, requiredText, z } from "@/lib/validation/form";

/** Locking names the period by its first day; the row itself is looked up by the action. */
export const lockPayPeriodSchema = z.object({
  periodStart: requiredDate("Pay period"),
});

export type LockPayPeriodInput = z.infer<typeof lockPayPeriodSchema>;

/**
 * Reopening adds the reason. Only its shape is checked here: the action trims
 * it, caps it at 500 characters and refuses a blank one with its own message,
 * because that wording is part of the audit trail's contract.
 */
export const reopenPayPeriodSchema = z.object({
  periodStart: requiredDate("Pay period"),
  reason: z.string(),
});

export type ReopenPayPeriodInput = z.infer<typeof reopenPayPeriodSchema>;

/**
 * The reopen dialog's single field, checked in the browser before the action
 * runs: a blank reason is refused where it is typed, with the same 500-character
 * cap the action applies.
 */
export const reopenReasonSchema = z.object({
  value: requiredText(500, "Reason"),
});
