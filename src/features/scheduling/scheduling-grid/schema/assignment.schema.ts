import { requiredUuid, z } from "@/lib/validation/form";

/** Grid columns are Sunday (0) through Saturday (6). */
const dayOfWeek = z.number().int().min(0).max(6);

/** assignPerson: place a person into a (line, location, day) cell. */
export const assignPersonSchema = z.object({
  weekId: requiredUuid("week id"),
  lineId: requiredUuid("line id"),
  locationId: requiredUuid("location id"),
  dayOfWeek,
  personId: requiredUuid("person id"),
});
export type AssignPersonInput = z.infer<typeof assignPersonSchema>;

/** removeAssignment. */
export const removeAssignmentSchema = z.object({
  assignmentId: requiredUuid("assignment id"),
});
export type RemoveAssignmentInput = z.infer<typeof removeAssignmentSchema>;

/** moveAssignment: drag an assignment to another (line, location, day) cell. */
export const moveAssignmentSchema = z.object({
  assignmentId: requiredUuid("assignment id"),
  targetLineId: requiredUuid("target line id"),
  targetLocationId: requiredUuid("target location id"),
  targetDay: dayOfWeek,
});
export type MoveAssignmentInput = z.infer<typeof moveAssignmentSchema>;
