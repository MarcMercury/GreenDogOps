import "server-only";

// ---------------------------------------------------------------------------
// Keeps greendogops.person_slack_link in step with the Slack workspace.
//
//   runSlackUserSync()          nightly cron / "Sync now" / Admin ▸ Agents
//   refreshSlackLinkForPerson() after an employee is created or their email or
//                               status changes (best-effort, never throws)
//   linkPersonToSlackUser()     admin picked a Slack account by hand
//   disconnectPersonSlack()     admin unlinked it
//
// The rules (email only, never by name, never silently re-link) live in
// ./matching.ts. In scope: people Ops can schedule or message — employees and
// contractors that are active. Former employees keep their link row for audit;
// senders must check person.status before using it.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { todayLA } from "@/lib/sheets/common";
import {
  isLinkableMember,
  planDiffers,
  planSlackLinks,
  searchSlackMembers,
  type SlackLinkPlan,
  type SlackLinkState,
  type SlackLinkStatus,
  type SlackMatchMethod,
  type SlackMatchPerson,
  type SlackMember,
} from "./matching";
import { getSlackMember, listSlackMembers, SlackApiError } from "./users";
import { isSlackConfigured } from "./client";

export const SLACK_SYNC_AGENT_KEY = "slack_user_sync";

/** person.status values the link sync is responsible for. */
export const SLACK_LINK_PERSON_STATUSES = ["employee", "contractor"] as const;

type Admin = ReturnType<typeof createAdminClient>;

interface LinkRow {
  person_id: string;
  status: SlackLinkStatus;
  slack_team_id: string | null;
  slack_user_id: string | null;
  slack_email: string | null;
  slack_display_name: string | null;
  slack_real_name: string | null;
  match_method: SlackMatchMethod | null;
  matched_by: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
}

const LINK_COLUMNS =
  "person_id, status, slack_team_id, slack_user_id, slack_email, slack_display_name, slack_real_name, match_method, matched_by, connected_at, last_checked_at, last_error";

function toState(row: LinkRow): SlackLinkState {
  return {
    personId: row.person_id,
    status: row.status,
    slackUserId: row.slack_user_id,
    slackTeamId: row.slack_team_id,
    slackEmail: row.slack_email,
    slackDisplayName: row.slack_display_name,
    slackRealName: row.slack_real_name,
    matchMethod: row.match_method,
    lastError: row.last_error,
  };
}

/** Active employees/contractors (or the given ids) with every email we know. */
async function loadPeople(admin: Admin, personIds?: string[]): Promise<SlackMatchPerson[]> {
  let query = admin
    .from("person")
    .select("id, email")
    .in("status", [...SLACK_LINK_PERSON_STATUSES])
    .eq("is_active", true);
  if (personIds) query = query.in("id", personIds);
  const { data: people, error } = await query;
  if (error) throw new Error(`load people: ${error.message}`);
  const rows = (people ?? []) as { id: string; email: string | null }[];
  if (rows.length === 0) return [];

  const { data: users, error: uErr } = await admin
    .from("app_user")
    .select("person_id, email")
    .in(
      "person_id",
      rows.map((r) => r.id),
    );
  if (uErr) throw new Error(`load login emails: ${uErr.message}`);
  const loginEmails = new Map<string, string[]>();
  for (const u of (users ?? []) as { person_id: string; email: string | null }[]) {
    if (!u.email) continue;
    loginEmails.set(u.person_id, [...(loginEmails.get(u.person_id) ?? []), u.email]);
  }

  return rows.map((r) => ({
    personId: r.id,
    emails: [r.email, ...(loginEmails.get(r.id) ?? [])].filter((e): e is string => Boolean(e)),
  }));
}

async function loadLinks(admin: Admin): Promise<LinkRow[]> {
  const { data, error } = await admin.from("person_slack_link").select(LINK_COLUMNS);
  if (error) throw new Error(`load Slack links: ${error.message}`);
  return (data ?? []) as LinkRow[];
}

function toRow(plan: SlackLinkPlan, prior: LinkRow | undefined, nowIso: string) {
  return {
    person_id: plan.personId,
    status: plan.status,
    slack_team_id: plan.slackTeamId,
    slack_user_id: plan.slackUserId,
    slack_email: plan.slackEmail,
    slack_display_name: plan.slackDisplayName,
    slack_real_name: plan.slackRealName,
    match_method: plan.matchMethod,
    // Keep who made a manual link for as long as it points at the same account.
    matched_by:
      prior && plan.slackUserId === prior.slack_user_id && plan.matchMethod === prior.match_method
        ? prior.matched_by
        : null,
    connected_at: plan.newlyConnected ? nowIso : plan.slackUserId ? (prior?.connected_at ?? null) : null,
    last_checked_at: nowIso,
    last_error: plan.lastError,
  };
}

export interface SlackSyncCounts {
  scanned: number;
  connected: number;
  newlyConnected: number;
  notFound: number;
  ambiguous: number;
  inactive: number;
  disconnected: number;
  changed: number;
}

export interface SlackSyncResult {
  ok: boolean;
  runId: string | null;
  counts: SlackSyncCounts;
  error?: string;
}

function emptyCounts(): SlackSyncCounts {
  return {
    scanned: 0,
    connected: 0,
    newlyConnected: 0,
    notFound: 0,
    ambiguous: 0,
    inactive: 0,
    disconnected: 0,
    changed: 0,
  };
}

export interface SlackSyncOptions {
  trigger?: "scheduled" | "manual" | "event";
  triggeredBy?: string | null;
  triggeredByEmail?: string | null;
  /** Only these people (default: everyone in scope). */
  personIds?: string[];
  /** People an admin asked to re-match even if disconnected / inactive. */
  retryPersonIds?: string[];
  /** Record an agent_run (default true; false for single-person refreshes). */
  recordRun?: boolean;
}

/**
 * Match people to Slack accounts and reconcile existing links. Throws nothing:
 * failures come back as `{ ok: false, error }` and on the agent_run row.
 */
export async function runSlackUserSync(options: SlackSyncOptions = {}): Promise<SlackSyncResult> {
  const { trigger = "scheduled", recordRun = true } = options;
  const admin = createAdminClient();
  const startedAt = new Date();
  const counts = emptyCounts();

  let agentId: string | null = null;
  let runId: string | null = null;
  if (recordRun) {
    const { data: agent } = await admin
      .from("agent")
      .select("id")
      .eq("key", SLACK_SYNC_AGENT_KEY)
      .maybeSingle();
    agentId = (agent as { id: string } | null)?.id ?? null;
    if (agentId) {
      const { data: run } = await admin
        .from("agent_run")
        .insert({
          agent_id: agentId,
          trigger: trigger === "event" ? "manual" : trigger,
          status: "running",
          target_date: todayLA(),
          started_at: startedAt.toISOString(),
          triggered_by: options.triggeredBy ?? null,
          triggered_by_email:
            options.triggeredByEmail ?? (trigger === "scheduled" ? "system:cron" : null),
        })
        .select("id")
        .single();
      runId = (run as { id: string } | null)?.id ?? null;
    }
  }

  let error: string | undefined;
  try {
    if (!isSlackConfigured()) {
      throw new SlackApiError("Slack is not configured. Set SLACK_BOT_TOKEN.", "not_configured");
    }
    const members = await listSlackMembers();
    if (!members.some((m) => isLinkableMember(m) && m.email)) {
      throw new Error(
        "Slack returned no member emails — check the users:read.email scope before trusting a sync.",
      );
    }

    const [people, linkRows] = await Promise.all([
      loadPeople(admin, options.personIds),
      loadLinks(admin),
    ]);
    const linkByPerson = new Map(linkRows.map((r) => [r.person_id, r]));
    const plans = planSlackLinks(
      people,
      linkRows.map(toState),
      members,
      new Set(options.retryPersonIds ?? []),
    );

    const nowIso = new Date().toISOString();
    const changed: ReturnType<typeof toRow>[] = [];
    const unchanged: string[] = [];
    for (const plan of plans) {
      const prior = linkByPerson.get(plan.personId);
      counts.scanned++;
      if (plan.status === "connected") counts.connected++;
      if (plan.status === "not_found") counts.notFound++;
      if (plan.status === "ambiguous") counts.ambiguous++;
      if (plan.status === "inactive") counts.inactive++;
      if (plan.status === "disconnected") counts.disconnected++;
      if (plan.newlyConnected) counts.newlyConnected++;
      if (planDiffers(plan, prior ? toState(prior) : undefined)) changed.push(toRow(plan, prior, nowIso));
      else unchanged.push(plan.personId);
    }
    counts.changed = changed.length;

    if (changed.length) {
      const { error: upErr } = await admin
        .from("person_slack_link")
        .upsert(changed, { onConflict: "person_id" });
      if (upErr) throw new Error(`save Slack links: ${upErr.message}`);
    }
    if (unchanged.length) {
      const { error: tErr } = await admin
        .from("person_slack_link")
        .update({ last_checked_at: nowIso })
        .in("person_id", unchanged);
      if (tErr) throw new Error(`stamp Slack links: ${tErr.message}`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (runId && agentId) {
    const finishedAt = new Date();
    const status = error ? "error" : "success";
    await admin
      .from("agent_run")
      .update({
        status,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        records_processed: counts.scanned,
        records_new: counts.newlyConnected,
        error: error ?? null,
        detail: counts,
      })
      .eq("id", runId);
    await admin
      .from("agent")
      .update({ last_run_at: finishedAt.toISOString(), last_status: status })
      .eq("id", agentId);
  }

  return error ? { ok: false, runId, counts, error } : { ok: true, runId, counts };
}

/**
 * Re-match one person after their record changes (created, email edited,
 * status changed). Connected links are kept by id, so this only ever fills in
 * a missing link. Best-effort: never throws, no-op when Slack isn't set up.
 */
export async function refreshSlackLinkForPerson(personId: string): Promise<void> {
  if (!isSlackConfigured()) return;
  try {
    const existing = await getSlackLinkForPerson(personId);
    // Connected / inactive links are kept by id and disconnected ones are left
    // alone, so only an unmatched person is worth a Slack call.
    if (existing && !["not_found", "ambiguous"].includes(existing.status)) return;
    const result = await runSlackUserSync({
      trigger: "event",
      personIds: [personId],
      recordRun: false,
    });
    if (!result.ok) console.error("[slack] link refresh failed:", result.error);
  } catch (err) {
    console.error("[slack] link refresh failed:", err);
  }
}

export type SlackLinkActionResult = { ok: true } | { ok: false; error: string };

/** An admin links a person to a Slack account by hand (emails need not agree). */
export async function linkPersonToSlackUser(
  personId: string,
  slackUserId: string,
  actorId: string | null,
): Promise<SlackLinkActionResult> {
  if (!/^[UW][A-Z0-9]+$/.test(slackUserId)) return { ok: false, error: "Invalid Slack user id." };
  const admin = createAdminClient();

  const { data: person } = await admin
    .from("person")
    .select("id")
    .eq("id", personId)
    .maybeSingle();
  if (!person) return { ok: false, error: "Person not found." };

  let member: SlackMember | null;
  try {
    member = await getSlackMember(slackUserId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!member || !isLinkableMember(member)) {
    return { ok: false, error: "That Slack account is deactivated or is not a person." };
  }

  const { data: holder } = await admin
    .from("person_slack_link")
    .select("person_id, person:person_id (full_name)")
    .eq("slack_user_id", member.id)
    .eq("status", "connected")
    .neq("person_id", personId)
    .maybeSingle();
  if (holder) {
    const embed = (holder as { person?: { full_name?: string | null } | { full_name?: string | null }[] | null })
      .person;
    const name = (Array.isArray(embed) ? embed[0] : embed)?.full_name ?? "another person";
    return {
      ok: false,
      error: `That Slack account is already linked to ${name}. Disconnect it there first.`,
    };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("person_slack_link").upsert(
    {
      person_id: personId,
      status: "connected",
      slack_team_id: member.teamId,
      slack_user_id: member.id,
      slack_email: member.email?.trim().toLowerCase() || null,
      slack_display_name: member.displayName,
      slack_real_name: member.realName,
      match_method: "manual",
      matched_by: actorId,
      connected_at: nowIso,
      last_checked_at: nowIso,
      last_error: null,
    },
    { onConflict: "person_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * An admin unlinks a person. The Slack id is kept for audit; the nightly sync
 * leaves a disconnected link alone until an admin retries or re-links it.
 */
export async function disconnectPersonSlack(personId: string): Promise<SlackLinkActionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("person_slack_link")
    .update({ status: "disconnected", last_error: "Unlinked by an admin." })
    .eq("person_id", personId)
    .select("person_id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "This person has no Slack link." };
  return { ok: true };
}

/** An admin asks to re-match one person by email (even if disconnected). */
export async function retrySlackMatch(
  personId: string,
  actorId: string | null,
  actorEmail: string | null,
): Promise<SlackSyncResult> {
  return runSlackUserSync({
    trigger: "manual",
    triggeredBy: actorId,
    triggeredByEmail: actorEmail,
    personIds: [personId],
    retryPersonIds: [personId],
    recordRun: false,
  });
}

/** Slack accounts an admin can pick from, matching a search query. */
export async function searchSlackAccounts(query: string): Promise<SlackMember[]> {
  return searchSlackMembers(await listSlackMembers(), query);
}

// ---------------------------------------------------------------------------
// Read models for the admin screen and the HR profile.
// ---------------------------------------------------------------------------

export interface SlackLinkView {
  status: SlackLinkStatus;
  slackUserId: string | null;
  slackEmail: string | null;
  slackDisplayName: string | null;
  slackRealName: string | null;
  matchMethod: SlackMatchMethod | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

function toView(row: LinkRow): SlackLinkView {
  return {
    status: row.status,
    slackUserId: row.slack_user_id,
    slackEmail: row.slack_email,
    slackDisplayName: row.slack_display_name,
    slackRealName: row.slack_real_name,
    matchMethod: row.match_method,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

/** One person's link, or null (also null if the table isn't there yet). */
export async function getSlackLinkForPerson(personId: string): Promise<SlackLinkView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("person_slack_link")
    .select(LINK_COLUMNS)
    .eq("person_id", personId)
    .maybeSingle();
  if (error || !data) return null;
  return toView(data as LinkRow);
}

export interface SlackAdminRow {
  personId: string;
  name: string;
  status: string;
  opsEmail: string | null;
  loginEmail: string | null;
  link: SlackLinkView | null;
}

/** Everyone in scope with their link, sorted by name. */
export async function loadSlackAdminRows(): Promise<SlackAdminRow[]> {
  const admin = createAdminClient();
  const { data: people, error } = await admin
    .from("person")
    .select("id, full_name, first_name, last_name, email, status")
    .in("status", [...SLACK_LINK_PERSON_STATUSES])
    .eq("is_active", true);
  if (error) throw new Error(`load people: ${error.message}`);
  const rows = (people ?? []) as {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    status: string;
  }[];

  const [linksRes, usersRes] = await Promise.all([
    admin.from("person_slack_link").select(LINK_COLUMNS),
    admin.from("app_user").select("person_id, email").not("person_id", "is", null),
  ]);
  if (linksRes.error) throw new Error(`load Slack links: ${linksRes.error.message}`);
  const links = new Map(((linksRes.data ?? []) as LinkRow[]).map((r) => [r.person_id, r]));
  const logins = new Map(
    ((usersRes.data ?? []) as { person_id: string; email: string | null }[]).map((u) => [
      u.person_id,
      u.email,
    ]),
  );

  return rows
    .map((p) => {
      const link = links.get(p.id);
      return {
        personId: p.id,
        name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "(no name)",
        status: p.status,
        opsEmail: p.email,
        loginEmail: logins.get(p.id) ?? null,
        link: link ? toView(link) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
