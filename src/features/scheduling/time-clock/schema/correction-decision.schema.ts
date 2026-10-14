import { requiredUuid, z } from "@/lib/validation/form";

/**
 * Shape of a correction-request decision. `replaceTarget` is the raw dropdown
 * value (`"punch:<uuid>"` / `"adjustment:<uuid>"` / null); `lib/replace-target`
 * splits and checks it so a bad target keeps its own error message. The note
 * is truncated to 1000 characters by the RPC call, not rejected here.
 */
export const correctionDecisionSchema = z.object({
  requestId: requiredUuid("request id"),
  decision: z.enum(["approved", "denied"]),
  note: z.string(),
  replaceTarget: z.string().nullable(),
});

export type CorrectionDecisionInput = z.infer<typeof correctionDecisionSchema>;
