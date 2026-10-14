/** What every Time Clock approver action returns: one message either way. */
export type ApproverResult = { ok: true; message: string } | { ok: false; error: string };
