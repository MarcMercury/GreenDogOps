// Audience resolution — who gets an event, and who is left out and why.
// Pure: the engine loads the directory (src/lib/notify/directory.ts) and passes
// it in, so every routing and permission rule here is unit-tested.

import {
  canAccessModule,
  canEditModule,
  type AppUser,
  type ModuleKey,
} from "../auth/permissions";
import type { Audience, ExcludedRecipient, ResolvedRecipient, Sensitivity } from "./types";

/** One active employee/contractor, as the engine sees them. */
export interface DirectoryPerson {
  personId: string;
  name: string;
  /** Home location (person_employment.location_id). */
  locationId: string | null;
  /** Scheduling departments, via the person's scheduling roles. */
  departmentIds: string[];
  /** Connected Slack user id, or null. */
  slackUserId: string | null;
  /** Active Ops login, or null. */
  login: AppUser | null;
}

export interface AudienceEvent {
  subjectPersonIds: string[];
  candidatePersonIds?: string[];
  locationId?: string | null;
  actorUserId?: string | null;
}

export interface ResolveInput {
  audience: Audience;
  sensitivity: Sensitivity;
  /** Module whose access is required for non-subject recipients (sensitivity "module"). */
  module: ModuleKey | null;
  /** Module a recipient must be able to EDIT to use the event's action buttons. */
  actionModule?: ModuleKey | null;
  event: AudienceEvent;
  directory: DirectoryPerson[];
}

export interface ResolveResult {
  recipients: ResolvedRecipient[];
  excluded: ExcludedRecipient[];
}

const MODULE_LABEL: Partial<Record<ModuleKey, string>> = {
  schedule: "Scheduling",
  marketing: "Marketing",
  hr: "HR",
  ats: "Recruiting",
  resources: "Resources",
  dashboard: "the dashboard",
};

export function resolveAudience(input: ResolveInput): ResolveResult {
  const { audience, event, directory } = input;
  const byId = new Map(directory.map((p) => [p.personId, p]));
  const subjects = new Set(event.subjectPersonIds);
  const reasons = new Map<string, Set<string>>();
  const add = (personId: string, reason: string) => {
    const set = reasons.get(personId) ?? new Set<string>();
    set.add(reason);
    reasons.set(personId, set);
  };
  const inLocation = (p: DirectoryPerson) =>
    !audience.sameLocation || !event.locationId || p.locationId === event.locationId;

  if (audience.subjects) for (const id of event.subjectPersonIds) add(id, "subject");
  if (audience.candidates) for (const id of event.candidatePersonIds ?? []) add(id, "candidate");
  for (const id of audience.personIds) add(id, "person");

  const roles = new Set(audience.roles);
  const departments = new Set(audience.departmentIds);
  for (const p of directory) {
    if (!inLocation(p)) continue;
    if (p.login && roles.has(p.login.role)) add(p.personId, `role:${p.login.role}`);
    for (const m of audience.editorsOf) {
      if (p.login && canEditModule(p.login, m)) add(p.personId, `editor:${m}`);
    }
    if (p.departmentIds.some((d) => departments.has(d))) add(p.personId, "department");
  }

  const recipients: ResolvedRecipient[] = [];
  const excluded: ExcludedRecipient[] = [];

  for (const [personId, why] of reasons) {
    const p = byId.get(personId);
    if (!p) {
      excluded.push({ personId, name: "", reason: "Not an active employee or contractor." });
      continue;
    }
    if (
      audience.excludeActor &&
      event.actorUserId &&
      p.login?.id === event.actorUserId
    ) {
      excluded.push({ personId, name: p.name, reason: "Caused this event." });
      continue;
    }
    const isSubject = subjects.has(personId);
    if (input.sensitivity === "module" && !isSubject && input.module) {
      if (!p.login) {
        excluded.push({
          personId,
          name: p.name,
          reason: "No Ops login, so their access can't be checked for this restricted notification.",
        });
        continue;
      }
      if (!canAccessModule(p.login, input.module)) {
        excluded.push({
          personId,
          name: p.name,
          reason: `Their Ops access doesn't include ${MODULE_LABEL[input.module] ?? input.module}.`,
        });
        continue;
      }
    }
    recipients.push({
      personId,
      userId: p.login?.id ?? null,
      slackUserId: p.slackUserId,
      isSubject,
      reasons: [...why].sort(),
      canAct: Boolean(
        input.actionModule && p.login && canEditModule(p.login, input.actionModule),
      ),
      moduleAccess: Boolean(input.module && p.login && canAccessModule(p.login, input.module)),
    });
  }

  recipients.sort((a, b) => a.personId.localeCompare(b.personId));
  return { recipients, excluded };
}

/**
 * Re-check at send time that a recipient may still see a delivery: the module
 * it needs (null = subject/general content) must still be open to their login.
 */
export function stillAllowed(login: AppUser | null, requiredModule: string | null): boolean {
  if (!requiredModule) return true;
  if (!login) return false;
  return canAccessModule(login, requiredModule as ModuleKey);
}
