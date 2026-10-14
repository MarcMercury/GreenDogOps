import {
  checkboxDefaultOn,
  intInRange,
  optionalText,
  optionalTime,
  optionalUuid,
  requiredUuid,
  z,
} from "@/lib/validation/form";

/**
 * A Dept/Shift Template line (Set Up ▸ Dept/Shift Template). The form never
 * renders an "Active" box, so a template saved from it must stay active: a
 * MISSING `is_active` is `true`, and only an explicit off value turns it off.
 */
export const shiftTemplateSchema = z.object({
  id: optionalUuid,
  department_id: requiredUuid("department"),
  role_id: optionalUuid,
  new_role_name: optionalText(120),
  label: optionalText(120),
  start_time: optionalTime,
  end_time: optionalTime,
  sort_order: intInRange(0, 9999, 0),
  is_active: checkboxDefaultOn,
});
export type ShiftTemplateInput = z.infer<typeof shiftTemplateSchema>;

export const deleteShiftTemplateSchema = z.object({
  id: requiredUuid("shift template id"),
});
export type DeleteShiftTemplateInput = z.infer<typeof deleteShiftTemplateSchema>;
