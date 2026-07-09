import { createAdminClient } from "@/lib/supabase/admin";

export interface LogTransitionInput {
  personId?: string | null;
  contactId?: string | null;
  eventType: string;
  fromStage?: string | null;
  toStage?: string | null;
  detail?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

/**
 * Append a row to greendogops.profile_transition_log. Best-effort: never throws
 * so a logging failure can't block the profile move it is recording.
 */
export async function logProfileTransition(input: LogTransitionInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("profile_transition_log").insert({
      person_id: input.personId ?? null,
      contact_id: input.contactId ?? null,
      event_type: input.eventType,
      from_stage: input.fromStage ?? null,
      to_stage: input.toStage ?? null,
      detail: input.detail ?? null,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
    });
  } catch {
    // transition logging is best-effort
  }
}
