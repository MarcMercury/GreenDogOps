import {
  checkbox,
  intInRange,
  optionalText,
  optionalUuid,
  requiredText,
  requiredUuid,
  z,
} from "@/lib/validation/form";

/** The Department form (Set Up ▸ Departments and the grid's department modal). */
export const departmentSchema = z.object({
  id: optionalUuid,
  name: requiredText(120, "Department name"),
  code: optionalText(32),
  // Rendered straight into a style attribute on the grid.
  color: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : "#64748b"),
    z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #64748b."),
  ),
  sort_order: intInRange(0, 9999, 0),
  is_active: checkbox,
  show_in_planning: checkbox,
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const deleteDepartmentSchema = z.object({
  id: requiredUuid("department id"),
});
export type DeleteDepartmentInput = z.infer<typeof deleteDepartmentSchema>;
