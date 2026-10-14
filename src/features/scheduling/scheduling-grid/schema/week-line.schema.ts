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

/** What the Line dialog submits for the fields the two actions share. */
export interface WeekLineSubmitValues {
  department_id: string;
  /** "" = any role, otherwise a role id (the "+ New role…" choice is resolved before submit). */
  role_id: string;
  new_role_name: string;
  label: string;
  start_time: string;
  end_time: string;
  sort_order: string;
}

/** addWeekLine: an ad-hoc shift line on a week's grid. */
export const addWeekLineSchema = z
  .object({ week_id: requiredUuid("week"), ...weekLineFields })
  .refine(endsAfterStart, timeOrderMessage);
export type AddWeekLineInput = z.infer<typeof addWeekLineSchema>;
export type AddWeekLineValues = WeekLineSubmitValues & { week_id: string };

/** updateWeekLine: edits to an existing shift line. */
export const updateWeekLineSchema = z
  .object({ id: requiredUuid("line id"), ...weekLineFields })
  .refine(endsAfterStart, timeOrderMessage);
export type UpdateWeekLineInput = z.infer<typeof updateWeekLineSchema>;
export type UpdateWeekLineValues = WeekLineSubmitValues & { id: string };

/** The Line dialog's "Role (eligibility)" value for "+ New role…". */
export const NEW_ROLE_OPTION = "__new__";

/** The Line dialog's values as typed (the role select still holds `NEW_ROLE_OPTION`). */
export type WeekLineFormValues = WeekLineSubmitValues;

/**
 * Client-side validation for the Line dialog: the server fields, except that
 * `role_id` may still be the "+ New role…" sentinel, which then requires a
 * name. `toWeekLineInput()` turns the values into what the action parses.
 */
export const weekLineFormSchema = z
  .object({
    department_id: requiredUuid("department"),
    role_id: z.string(),
    new_role_name: optionalText(120),
    label: optionalText(120),
    start_time: optionalTime,
    end_time: optionalTime,
    sort_order: intInRange(0, 9999, 9999),
  })
  .refine(endsAfterStart, timeOrderMessage)
  .refine((v) => v.role_id !== NEW_ROLE_OPTION || !!v.new_role_name, {
    message: "Give the new role a name.",
    path: ["new_role_name"],
  });

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
