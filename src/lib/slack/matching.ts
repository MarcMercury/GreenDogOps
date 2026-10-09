// ---------------------------------------------------------------------------
// Ops person ↔ Slack user matching. Pure — no I/O — so the rules are pinned by
// matching.test.ts.
//
// Rules:
//   • Email is only how a link is FOUND. Once connected, the Slack user id is
//     what we keep, and a connected link is never re-matched by email again.
//   • Auto-matching is exact email only (case-insensitive) — never by name.
//   • Exactly one active Slack account → connected. None → not_found. Several,
//     or a Slack account another person already holds → ambiguous.
//   • A connected Slack account that is deactivated/removed → inactive, keeping
//     its id. If that same id comes back, the link reconnects — unless another
//     person was linked to it meanwhile. It never moves to a different Slack
//     account on its own, and no Slack account ends up connected twice.
//   • disconnected = an admin unlinked it on purpose: left alone by the sync.
// ---------------------------------------------------------------------------

export type SlackLinkStatus =
  | "connected"
  | "not_found"
  | "ambiguous"
  | "inactive"
  | "disconnected";

export const SLACK_LINK_STATUS_LABELS: Record<SlackLinkStatus, string> = {
  connected: "Connected",
  not_found: "Not found",
  ambiguous: "Ambiguous",
  inactive: "Slack account inactive",
  disconnected: "Disconnected",
};

export type SlackMatchMethod = "email" | "manual";

/** Not linked yet, or linked but unusable for a reason an admin should fix. */
export function slackLinkNeedsAttention(status: SlackLinkStatus | null | undefined): boolean {
  return !status || status === "not_found" || status === "ambiguous" || status === "inactive";
}

/** A Slack workspace member, as the sync needs it. */
export interface SlackMember {
  id: string;
  teamId: string | null;
  username: string | null;
  email: string | null;
  displayName: string | null;
  realName: string | null;
  deleted: boolean;
  isBot: boolean;
}

/** A person the sync is responsible for, with every email we know for them. */
export interface SlackMatchPerson {
  personId: string;
  emails: string[];
}

/** The stored link for a person (subset of person_slack_link). */
export interface SlackLinkState {
  personId: string;
  status: SlackLinkStatus;
  slackUserId: string | null;
  slackTeamId: string | null;
  slackEmail: string | null;
  slackDisplayName: string | null;
  slackRealName: string | null;
  matchMethod: SlackMatchMethod | null;
  lastError: string | null;
}

/** The link a person should have after this sync. */
export interface SlackLinkPlan {
  personId: string;
  status: SlackLinkStatus;
  slackUserId: string | null;
  slackTeamId: string | null;
  slackEmail: string | null;
  slackDisplayName: string | null;
  slackRealName: string | null;
  matchMethod: SlackMatchMethod | null;
  lastError: string | null;
  /** True when the link became connected in this sync (stamp connected_at). */
  newlyConnected: boolean;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v.includes("@") ? v : null;
}

/** Real people only: Slackbot and app/bot users can never be linked. */
export function isLinkableMember(m: SlackMember): boolean {
  return !m.deleted && !m.isBot && m.id !== "USLACKBOT";
}

/** Fields copied from the Slack account onto a link. */
function memberFields(m: SlackMember) {
  return {
    slackUserId: m.id,
    slackTeamId: m.teamId,
    slackEmail: normalizeEmail(m.email),
    slackDisplayName: m.displayName || null,
    slackRealName: m.realName || null,
  };
}

function keep(link: SlackLinkState, patch: Partial<SlackLinkPlan> = {}): SlackLinkPlan {
  return {
    personId: link.personId,
    status: link.status,
    slackUserId: link.slackUserId,
    slackTeamId: link.slackTeamId,
    slackEmail: link.slackEmail,
    slackDisplayName: link.slackDisplayName,
    slackRealName: link.slackRealName,
    matchMethod: link.matchMethod,
    lastError: link.lastError,
    newlyConnected: false,
    ...patch,
  };
}

function unlinked(
  personId: string,
  status: "not_found" | "ambiguous",
  lastError: string,
): SlackLinkPlan {
  return {
    personId,
    status,
    slackUserId: null,
    slackTeamId: null,
    slackEmail: null,
    slackDisplayName: null,
    slackRealName: null,
    matchMethod: null,
    lastError,
    newlyConnected: false,
  };
}

/** Linkable Slack members keyed by normalized email. */
export function indexMembersByEmail(members: SlackMember[]): Map<string, SlackMember[]> {
  const byEmail = new Map<string, SlackMember[]>();
  for (const m of members) {
    if (!isLinkableMember(m)) continue;
    const email = normalizeEmail(m.email);
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(m);
    byEmail.set(email, list);
  }
  return byEmail;
}

/**
 * Work out the link every person should have, given the current links and the
 * Slack workspace's members.
 *
 * `retryPersonIds` are people an admin explicitly asked to re-match: they are
 * matched by email even if currently disconnected or inactive.
 */
export function planSlackLinks(
  people: SlackMatchPerson[],
  links: SlackLinkState[],
  members: SlackMember[],
  retryPersonIds: ReadonlySet<string> = new Set(),
): SlackLinkPlan[] {
  const linkByPerson = new Map(links.map((l) => [l.personId, l]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const byEmail = indexMembersByEmail(members);

  // Slack accounts held by someone's connected link — including people outside
  // this run (e.g. former employees) — can't be auto-assigned to anyone else.
  const heldBy = new Map<string, string>();
  for (const l of links) {
    if (l.status === "connected" && l.slackUserId && !retryPersonIds.has(l.personId)) {
      heldBy.set(l.slackUserId, l.personId);
    }
  }

  const plans = new Map<string, SlackLinkPlan>();
  const toMatch: SlackMatchPerson[] = [];

  for (const person of people) {
    const link = linkByPerson.get(person.personId);
    const retry = retryPersonIds.has(person.personId);

    if (link && !retry && (link.status === "connected" || link.status === "inactive")) {
      const member = link.slackUserId ? memberById.get(link.slackUserId) : undefined;
      const holder = member ? heldBy.get(member.id) : undefined;
      if (member && isLinkableMember(member) && holder && holder !== person.personId) {
        // The account came back, but someone else was linked to it meanwhile.
        plans.set(
          person.personId,
          keep(link, {
            status: "inactive",
            lastError: "This Slack account is now linked to another person.",
          }),
        );
      } else if (member && isLinkableMember(member)) {
        heldBy.set(member.id, person.personId);
        plans.set(
          person.personId,
          keep(link, {
            ...memberFields(member),
            status: "connected",
            lastError: null,
            newlyConnected: link.status !== "connected",
          }),
        );
      } else {
        plans.set(
          person.personId,
          keep(link, {
            status: "inactive",
            lastError: member
              ? "The linked Slack account has been deactivated."
              : "The linked Slack account is no longer in the workspace.",
          }),
        );
      }
      continue;
    }

    if (link && !retry && link.status === "disconnected") {
      plans.set(person.personId, keep(link));
      continue;
    }

    toMatch.push(person);
  }

  // Email candidates per person, then how many people want each Slack account.
  const candidates = new Map<string, SlackMember[]>();
  const claimants = new Map<string, number>();
  for (const person of toMatch) {
    const found = new Map<string, SlackMember>();
    for (const raw of person.emails) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      for (const m of byEmail.get(email) ?? []) found.set(m.id, m);
    }
    const list = [...found.values()];
    candidates.set(person.personId, list);
    if (list.length === 1) {
      claimants.set(list[0].id, (claimants.get(list[0].id) ?? 0) + 1);
    }
  }

  for (const person of toMatch) {
    const list = candidates.get(person.personId) ?? [];
    if (list.length === 0) {
      plans.set(
        person.personId,
        unlinked(
          person.personId,
          "not_found",
          person.emails.some((e) => normalizeEmail(e))
            ? "No active Slack account uses this person's email."
            : "This person has no email address in Ops.",
        ),
      );
      continue;
    }
    if (list.length > 1) {
      plans.set(
        person.personId,
        unlinked(
          person.personId,
          "ambiguous",
          `${list.length} Slack accounts match this person's emails. Pick one manually.`,
        ),
      );
      continue;
    }

    const member = list[0];
    const holder = heldBy.get(member.id);
    if (holder && holder !== person.personId) {
      plans.set(
        person.personId,
        unlinked(
          person.personId,
          "ambiguous",
          "The matching Slack account is already linked to another person.",
        ),
      );
      continue;
    }
    if ((claimants.get(member.id) ?? 0) > 1) {
      plans.set(
        person.personId,
        unlinked(
          person.personId,
          "ambiguous",
          "Several people in Ops share the email of this Slack account.",
        ),
      );
      continue;
    }

    const prior = linkByPerson.get(person.personId);
    plans.set(person.personId, {
      personId: person.personId,
      status: "connected",
      ...memberFields(member),
      matchMethod: "email",
      lastError: null,
      newlyConnected: !(prior?.status === "connected" && prior.slackUserId === member.id),
    });
  }

  return people.map((p) => plans.get(p.personId)!);
}

/** True when applying `plan` would change the stored link. */
export function planDiffers(plan: SlackLinkPlan, link: SlackLinkState | undefined): boolean {
  if (!link) return true;
  return (
    plan.status !== link.status ||
    plan.slackUserId !== link.slackUserId ||
    plan.slackTeamId !== link.slackTeamId ||
    plan.slackEmail !== link.slackEmail ||
    plan.slackDisplayName !== link.slackDisplayName ||
    plan.slackRealName !== link.slackRealName ||
    plan.matchMethod !== link.matchMethod ||
    plan.lastError !== link.lastError
  );
}

/** Admin picker search: name, @handle or email contains every query word. */
export function searchSlackMembers(
  members: SlackMember[],
  query: string,
  limit = 20,
): SlackMember[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return members
    .filter(isLinkableMember)
    .filter((m) => {
      const hay = [m.realName, m.displayName, m.username, m.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) =>
      (a.realName ?? a.displayName ?? "").localeCompare(b.realName ?? b.displayName ?? ""),
    )
    .slice(0, limit);
}
