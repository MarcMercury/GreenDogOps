import { requiredUuid, z } from "@/lib/validation/form";

/** A person's non-shift student flags (Mentor / Coordinator eligibility). */
export const studentRoleFlagsSchema = z.object({
  personId: requiredUuid("person id"),
  isMentor: z.boolean(),
  isCoordinator: z.boolean(),
});
export type StudentRoleFlagsInput = z.infer<typeof studentRoleFlagsSchema>;
