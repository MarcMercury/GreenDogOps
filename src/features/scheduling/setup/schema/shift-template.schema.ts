import {
  checkboxDefaultOn,
  intInRange,
  optionalText,
  optionalTime,
  optionalUuid,
  requiredUuid,
  z,
} from "@/lib/validation/form";
import {
  NEW_ROLE_OPTION,
  toShiftTemplateInput,
} from "@/features/scheduling/setup/lib/shift-template-submit";

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

/**
 * What the template-line form holds. `role_id` is the Role select's raw value:
 * "" (any role), an existing role id, or `NEW_ROLE_OPTION` with the name typed
 * into `new_role_name`. `toShiftTemplateInput` turns it into what the action
 * accepts.
 */
export interface ShiftTemplateFormValues {
  id: string | null;
  department_id: string;
  role_id: string;
  new_role_name: string;
  label: string;
  start_time: string;
  end_time: string;
  sort_order: string;
}

/**
 * The form's client-side validator: first the one rule the raw select value
 * carries ("+ New role…" needs a name), then the same rules the action applies,
 * run on the mapped input — so a line that passes here is exactly a line the
 * action will accept.
 */
export const shiftTemplateFormSchema = z
  .looseObject({ role_id: z.string(), new_role_name: z.string() })
  .refine((v) => !(v.role_id === NEW_ROLE_OPTION && !v.new_role_name.trim()), {
    message: "Give the new role a name.",
    path: ["new_role_name"],
  })
  .pipe(
    z.preprocess(
      (v) => toShiftTemplateInput(v as unknown as ShiftTemplateFormValues),
      shiftTemplateSchema,
    ),
  );

export const deleteShiftTemplateSchema = z.object({
  id: requiredUuid("shift template id"),
});
export type DeleteShiftTemplateInput = z.infer<typeof deleteShiftTemplateSchema>;
