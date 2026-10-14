import { requiredDate, z } from "@/lib/validation/form";

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
