import { requiredUuid, z } from "@/lib/validation/form";

/**
 * setEvent: the banner note above a location/day cell. A blank title clears
 * the event — the action trims and decides, so the schema only caps length.
 */
export const setEventSchema = z.object({
  weekId: requiredUuid("week id"),
  locationId: requiredUuid("location id"),
  dayOfWeek: z.number().int().min(0).max(6),
  title: z.string().max(200),
});
export type SetEventInput = z.infer<typeof setEventSchema>;
