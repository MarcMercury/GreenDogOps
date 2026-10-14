import { z } from "@/lib/validation/form";

/**
 * `?date=YYYY-MM-DD` on Scheduling ▸ Time & Attendance. Optional — the page
 * opens on today without it. This checks the shape only; whether the date is a
 * real calendar day inside the two-week window is `resolveDate()`'s call, and a
 * value that fails here is treated as absent, never as an error.
 */
export const dateParamSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type DateParamInput = z.infer<typeof dateParamSchema>;
