import { checkbox, requiredUuid, z } from "@/lib/validation/form";

/**
 * What the "Add the missing punch" form holds and submits. The TanStack Form
 * keeps every input as a string (the time stays "HH:MM"); the checkbox is the
 * one boolean. The action parses this through `addPunchSchema`.
 */
export interface AddPunchFormValues {
  person_id: string;
  work_date: string;
  punch_type: string;
  time: string;
  next_day: boolean;
  reason: string;
}

/**
 * Shape of the "Add the missing punch" form. Only the employee id is checked
 * here; the date window, punch type, reason and time each have their own
 * message in the action ("Pick a date within the last 45 days.", "Pick which
 * punch.", "Please give a reason.", "Enter a valid time."), so they arrive as
 * plain strings — blank when the field was left out, exactly as
 * `formData.get(...) ?? ""` delivered them before.
 */
export const addPunchSchema = z.object({
  person_id: requiredUuid("employee"),
  work_date: z.string().default(""),
  punch_type: z.string().default(""),
  time: z.string().default(""),
  next_day: checkbox,
  reason: z.string().default(""),
});

export type AddPunchInput = z.infer<typeof addPunchSchema>;
