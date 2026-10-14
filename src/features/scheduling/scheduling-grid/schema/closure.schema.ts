import { requiredUuid, z } from "@/lib/validation/form";

/** toggleClosure: close or re-open one location on one day of a week. */
export const toggleClosureSchema = z.object({
  weekId: requiredUuid("week id"),
  locationId: requiredUuid("location id"),
  dayOfWeek: z.number().int().min(0).max(6),
});
export type ToggleClosureInput = z.infer<typeof toggleClosureSchema>;
