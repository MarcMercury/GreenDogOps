import { requiredUuid, z } from "@/lib/validation/form";

/**
 * Shape of an off-site punch decision. The business rules (no self-approval,
 * the RPC's own pending / already-reviewed checks) stay in the action. The
 * note is not capped here: the RPC call truncates it to 1000 characters, as
 * it always has, instead of rejecting a longer one.
 */
export const offsiteReviewSchema = z.object({
  punchId: requiredUuid("punch id"),
  decision: z.enum(["approved", "rejected"]),
  note: z.string(),
});

export type OffsiteReviewInput = z.infer<typeof offsiteReviewSchema>;
