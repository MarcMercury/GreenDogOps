/**
 * Payload of the atomic approver RPCs (`review_time_punch`,
 * `decide_time_correction`): `ok`, or an error code mapped to a message by
 * `lib/errors.ts`.
 */
export interface TimeClockRpcResult {
  ok: boolean;
  error?: string;
}
