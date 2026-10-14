import { requiredText, requiredUuid, z } from "@/lib/validation/form";

/** Names are unique case-insensitively (enforced by the database). */
const templateName = requiredText(80, "Template name");
const templateId = requiredUuid("template id");

export const createTemplateSchema = z.object({ name: templateName });
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const renameTemplateSchema = z.object({ templateId, name: templateName });
export type RenameTemplateInput = z.infer<typeof renameTemplateSchema>;

export const duplicateTemplateSchema = z.object({ templateId, name: templateName });
export type DuplicateTemplateInput = z.infer<typeof duplicateTemplateSchema>;

export const deleteTemplateSchema = z.object({ templateId });
export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>;

export const syncTemplateWeekSchema = z.object({ templateId });
export type SyncTemplateWeekInput = z.infer<typeof syncTemplateWeekSchema>;
