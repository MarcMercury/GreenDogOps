import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { postSlackMessage, isSlackConfigured } from "@/lib/slack/client";
import { recordAudit } from "@/lib/auth/session";
import { logProfileTransition } from "@/lib/shared/transition-log";
import { buildInterviewAnnouncement, buildInterviewScheduledMessage } from "./slack-messages";
import { candidateName, candidateProfileUrl, notifyCandidateThread } from "./slack-notify";
import { isAnnounceInterviewType, type PersonInterview } from "./types";

// ---------------------------------------------------------------------------
// The candidate's first Slack post. Early recruiting stays inside Ops; once an
// in-person interview or shadow is scheduled the candidate is announced in the
// hiring channel, and every later update replies in that one thread.
// ---------------------------------------------------------------------------

const DOCUMENTS_BUCKET = "employee-documents";

type Admin = ReturnType<typeof createAdminClient>;

export interface SlackActor {
  name: string | null;
  authId: string | null;
  email: string | null;
}

type ScheduledInterview = Pick<
  PersonInterview,
  "interview_type" | "interview_date" | "start_time" | "end_time" | "interviewer" | "location"
>;

interface CandidateInfo {
  name: string;
  role: string | null;
  score: number | null;
  announced: boolean;
  resumeUrl: string | null;
}

async function loadCandidate(admin: Admin, personId: string): Promise<CandidateInfo | null> {
  const { data } = await admin
    .from("person")
    .select(
      "full_name, first_name, last_name, person_recruiting(target_title, score, slack_announce_ts, resume_url)",
    )
    .eq("id", personId)
    .maybeSingle();
  if (!data) return null;
  const recRaw = (data as { person_recruiting?: unknown }).person_recruiting;
  const rec = (Array.isArray(recRaw) ? recRaw[0] : recRaw) as {
    target_title: string | null;
    score: number | null;
    slack_announce_ts: string | null;
    resume_url: string | null;
  } | null;
  return {
    name: candidateName(data as { full_name: string | null; first_name: string | null; last_name: string | null }),
    role: rec?.target_title ?? null,
    score: rec?.score ?? null,
    announced: Boolean(rec?.slack_announce_ts),
    resumeUrl: rec?.resume_url ?? null,
  };
}

/** The resume URL entered on the profile, else the newest resume, signed for a week. */
async function resumeLink(admin: Admin, personId: string, explicit: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const { data: doc } = await admin
    .from("person_document")
    .select("storage_path")
    .eq("person_id", personId)
    .ilike("category", "resume")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const path = (doc as { storage_path?: string } | null)?.storage_path;
  if (!path) return null;
  const { data: signed } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed?.signedUrl ?? null;
}

/** Which earlier steps the candidate has completed, for the announcement checklist. */
async function completedSteps(admin: Admin, personId: string): Promise<{ screening: boolean; phone: boolean; opsApplication: boolean }> {
  const [{ data: responses }, { data: interviews }] = await Promise.all([
    admin.from("recruiting_form_response").select("form_kind").eq("person_id", personId),
    admin
      .from("person_interview")
      .select("interview_type")
      .eq("person_id", personId)
      .eq("status", "completed"),
  ]);
  const kinds = ((responses ?? []) as { form_kind: string }[]).map((r) => r.form_kind);
  const types = ((interviews ?? []) as { interview_type: string | null }[]).map((i) => i.interview_type);
  return {
    screening: kinds.includes("screening"),
    phone: types.some((t) => t === "phone_screen" || t === "virtual"),
    opsApplication: kinds.includes("application"),
  };
}

export type AnnounceResult = { ok: true; announced: boolean } | { ok: false; error: string };

/**
 * Post the announcement for a candidate who hasn't been announced yet and
 * keep its ts so everything after replies in the thread.
 */
export async function postCandidateAnnouncement(
  personId: string,
  interview: ScheduledInterview | null,
  actor: SlackActor,
): Promise<AnnounceResult> {
  if (!isSlackConfigured()) return { ok: false, error: "Slack isn't configured (SLACK_BOT_TOKEN is not set)." };
  const admin = createAdminClient();
  const c = await loadCandidate(admin, personId);
  if (!c) return { ok: false, error: "Candidate not found." };
  if (c.announced) return { ok: false, error: "Already announced — updates reply in the original Slack thread." };

  const [steps, resume] = await Promise.all([
    completedSteps(admin, personId),
    resumeLink(admin, personId, c.resumeUrl),
  ]);
  const profile = candidateProfileUrl(personId);
  const text = buildInterviewAnnouncement({
    name: c.name,
    role: c.role,
    score: c.score,
    interview: interview?.interview_type
      ? {
          type: interview.interview_type,
          date: interview.interview_date,
          time: interview.start_time,
          location: interview.location,
          interviewer: interview.interviewer,
        }
      : null,
    steps,
    links: {
      resume,
      application: `${profile}?tab=${steps.opsApplication ? "forms" : "application"}`,
      profile,
    },
  });

  const result = await postSlackMessage({ channelKey: "hiring", text, username: actor.name });
  if (!result.ok) return { ok: false, error: result.error ?? "Slack post failed." };

  const { error } = await admin
    .from("person_recruiting")
    .update({
      slack_announce_ts: result.ts ?? null,
      slack_announce_channel: result.channel ?? null,
      announced_at: new Date().toISOString(),
      announced_by: actor.authId,
    })
    .eq("person_id", personId);
  if (actor.authId && actor.email) {
    await recordAudit({
      actorId: actor.authId,
      actorEmail: actor.email,
      action: "slack.post",
      entity: "person",
      entityId: personId,
      summary: "Announced candidate in Slack",
      metadata: { channel: result.channel, ts: result.ts },
    });
  }
  await logProfileTransition({
    personId,
    eventType: "slack_announced",
    detail: interview?.interview_type ? "Announced in Slack when the interview was scheduled" : "Announced in Slack",
    actorId: actor.authId,
    actorName: actor.name,
  });
  if (error) return { ok: false, error: `Posted to Slack, but couldn't save the thread link: ${error.message}` };
  return { ok: true, announced: true };
}

/**
 * A newly scheduled interview: an in-person interview or shadow announces a
 * not-yet-announced candidate; for an announced candidate any interview
 * replies in their thread; otherwise (early phone screens) nothing is posted.
 */
export async function slackInterviewScheduled(
  personId: string,
  interview: ScheduledInterview,
  actor: SlackActor,
): Promise<void> {
  if (!isSlackConfigured()) return;
  try {
    const admin = createAdminClient();
    const c = await loadCandidate(admin, personId);
    if (!c) return;
    if (!c.announced) {
      if (!isAnnounceInterviewType(interview.interview_type)) return;
      const res = await postCandidateAnnouncement(personId, interview, actor);
      if (!res.ok) console.error("[ats] Slack announcement failed:", res.error);
      return;
    }
    await notifyCandidateThread({
      personId,
      text: buildInterviewScheduledMessage(c.name, interview, actor.name),
      username: actor.name,
      actorId: actor.authId,
      actorEmail: actor.email,
    });
  } catch (err) {
    console.error("[ats] Slack interview post failed:", err);
  }
}
