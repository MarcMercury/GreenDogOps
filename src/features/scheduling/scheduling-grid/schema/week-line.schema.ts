import {
  intInRange,
  optionalText,
  optionalTime,
  optionalUuid,
  requiredUuid,
  z,
} from "@/lib/validation/form";

/** Fields shared by adding and editing a shift line. */
const weekLineFields = {
  department_id: requiredUuid("department"),
  role_id: optionalUuid,
  new_role_name: optionalText(120),
  label: optionalText(120),
  start_time: optionalTime,
  end_time: optionalTime,
  sort_order: intInRange(0, 9999, 9999),
};

// A shift ending before it starts silently breaks the interval overlap maths
// behind double-booking detection, so it is rejected rather than stored.
const endsAfterStart = (v: { start_time: string | null; end_time: string | null }) =>
  !v.start_time || !v.end_time || v.end_time > v.start_time;
const timeOrderMessage = {
  message: "End time must be after start time.",
  path: ["end_time"],
};

/** addWeekLine (FormData): an ad-hoc shift line on a week's grid. */
export const addWeekLineSchema = z
  .object({ week_id: requiredUuid("week"), ...weekLineFields })
  .refine(endsAfterStart, timeOrderMessage);
export type AddWeekLineInput = z.infer<typeof addWeekLineSchema>;

/** updateWeekLine (FormData): edits to an existing shift line. */
export const updateWeekLineSchema = z
  .object({ id: requiredUuid("line id"), ...weekLineFields })
  .refine(endsAfterStart, timeOrderMessage);
export type UpdateWeekLineInput = z.infer<typeof updateWeekLineSchema>;

/** removeWeekLine. */
export const removeWeekLineSchema = z.object({
  lineId: requiredUuid("line id"),
});
export type RemoveWeekLineInput = z.infer<typeof removeWeekLineSchema>;

/** syncWeekLinesFromTemplates / applyDefaultTemplate: the week to (re)build. */
export const weekLinesForWeekSchema = z.object({
  weekId: requiredUuid("week id"),
});
export type WeekLinesForWeekInput = z.infer<typeof weekLinesForWeekSchema>;
