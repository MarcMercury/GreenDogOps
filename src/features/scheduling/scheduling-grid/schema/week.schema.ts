import { requiredDate, requiredUuid, z } from "@/lib/validation/form";

/** createWeek: the Sunday the new week starts on. */
export const createWeekSchema = z.object({
  weekStart: requiredDate("Week start"),
});
export type CreateWeekInput = z.infer<typeof createWeekSchema>;

/** copyPreviousWeek: the Sunday the cloned week starts on. */
export const copyPreviousWeekSchema = createWeekSchema;
export type CopyPreviousWeekInput = z.infer<typeof copyPreviousWeekSchema>;

/** applyWeekTemplate: which saved template to stamp onto which week. */
export const applyWeekTemplateSchema = z.object({
  weekId: requiredUuid("week id"),
  templateId: requiredUuid("template id"),
});
export type ApplyWeekTemplateInput = z.infer<typeof applyWeekTemplateSchema>;

/** setWeekLocations: the ordered list of locations shown on a week's grid. */
export const setWeekLocationsSchema = z.object({
  weekId: requiredUuid("week id"),
  locationIds: z.array(requiredUuid("location id")),
});
export type SetWeekLocationsInput = z.infer<typeof setWeekLocationsSchema>;

/** updateWeekMeta: title / notes are stored as given (null clears). */
export const updateWeekMetaSchema = z.object({
  weekId: requiredUuid("week id"),
  title: z.string().max(200).nullable(),
  notes: z.string().max(5000).nullable(),
});
export type UpdateWeekMetaInput = z.infer<typeof updateWeekMetaSchema>;

/** deleteWeek. */
export const deleteWeekSchema = z.object({
  weekId: requiredUuid("week id"),
});
export type DeleteWeekInput = z.infer<typeof deleteWeekSchema>;
