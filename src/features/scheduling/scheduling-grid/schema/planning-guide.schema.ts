import { requiredUuid, z } from "@/lib/validation/form";

/** generateGuideFromDay: the (week, day, location, department) to scaffold a guide for. */
export const generateGuideFromDaySchema = z.object({
  weekId: requiredUuid("week id"),
  day: z.number().int().min(0).max(6),
  locationId: requiredUuid("location id"),
  departmentId: requiredUuid("department id"),
});
export type GenerateGuideFromDayInput = z.infer<typeof generateGuideFromDaySchema>;

/**
 * generateGuideFromCapacity: the same cell plus the appointment number the
 * Daily Capacity tile shows (the action still clamps it to a whole number ≥ 0).
 */
export const generateGuideFromCapacitySchema = generateGuideFromDaySchema.extend({
  targetAppointments: z.number(),
});
export type GenerateGuideFromCapacityInput = z.infer<typeof generateGuideFromCapacitySchema>;
