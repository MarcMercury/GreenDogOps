import { optionalUuid, requiredUuid, z } from "@/lib/validation/form";

/** Mirror of the HR roster's "Preferred location" field; null clears it. */
export const preferredLocationSchema = z.object({
  personId: requiredUuid("person id"),
  locationId: optionalUuid,
});
export type PreferredLocationInput = z.infer<typeof preferredLocationSchema>;
