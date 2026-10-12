import "server-only";

// ---------------------------------------------------------------------------
// emitEvent — the one way a module publishes a notification event.
//
//   after(() => emitEvent({ type: "pto.requested", subjectId, subjectPersonIds,
//                           payload, dedupeKey }))
//
// Records the event, fans it out (rule + audience + permissions), sends what
// is due right away, and optionally updates earlier Slack cards about the
// same record. Never throws: a notification failure must not fail the action
// that caused it. The 5-minute dispatcher retries anything left pending.
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { createEvent, processEvent, resolveCards, type CreateEventInput } from "./engine";
import { dispatchPendingDeliveries } from "./dispatch";

export interface EmitEventInput extends CreateEventInput {
  /** Update earlier cards about this record (e.g. "pto:<id>" → "✅ Approved by Jane"). */
  resolve?: { messageKey: string; note: string } | null;
}

export type EmitResult = { ok: true; id: string; duplicate: boolean } | { ok: false; error: string };

export async function emitEvent(input: EmitEventInput): Promise<EmitResult> {
  try {
    if (input.resolve) await resolveCards(input.resolve.messageKey, input.resolve.note);
    const created = await createEvent(input);
    if (!created.ok) {
      console.error(`[notify] ${input.type}: ${created.error}`);
      return created;
    }
    if (!created.duplicate) {
      await processEvent(created.id);
      await dispatchPendingDeliveries({ trigger: "event", eventId: created.id });
    }
    return created;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[notify] ${input.type}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Run notification work after the response is sent (Server Actions / Route
 * Handlers); inline when there is no request (scripts, crons calling libs).
 */
export function runInBackground(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      console.error("[notify] background task failed:", err instanceof Error ? err.message : err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
