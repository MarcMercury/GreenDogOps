import { requiredUuid, z } from "@/lib/validation/form";

/** setTimeOffStatus: approve or deny a PTO request from the grid's PTO section. */
export const setTimeOffStatusSchema = z.object({
  id: requiredUuid("request id"),
  status: z.enum(["approved", "denied"]),
});
export type SetTimeOffStatusInput = z.infer<typeof setTimeOffStatusSchema>;
