// Defaults for the "Schedule / log an interview" form, so an interviewer
// launching an interview only types what can't be known up front (grade,
// notes). Values come from, in order: what the interview record already says,
// the candidate's pending scheduling link, the logged-in interviewer, the
// candidate's stage and the job's clinic. Times are clinic wall clock, like
// every other person_interview row.

import type { PersonInterview } from "./types";

export const DEFAULT_INTERVIEW_MINUTES = 30;
export const PHONE_LOCATION = "Phone call";
export const VIDEO_LOCATION = "Video call";

export interface InterviewFormValues {
  interview_date: string;
  start_time: string;
  end_time: string;
  interview_type: string;
  interviewer: string;
  location: string;
  /** Length used to derive the end time from the start time. */
  duration: number;
}

export interface InterviewPrefillContext {
  /** Clinic-local today ("YYYY-MM-DD") and time ("HH:MM"). */
  today: string;
  now: string;
  /** The logged-in interviewer. */
  me: { name: string; defaultDuration: number | null } | null;
  stage: string | null;
  /** Clinic the candidate's job is at, if it's an in-clinic job. */
  clinic: string | null;
  /** The candidate's newest unbooked scheduling link. */
  pendingInvite: {
    interview_type: string | null;
    host_name: string | null;
    location: string | null;
    duration_minutes: number | null;
  } | null;
}

const HHMM = /^(\d{2}):(\d{2})/;

function toMinutes(time: string | null | undefined): number | null {
  const m = HHMM.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "HH:MM" plus minutes, or "" when it would run past midnight. */
export function addMinutesToTime(time: string | null | undefined, minutes: number): string {
  const start = toMinutes(time);
  if (start == null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const end = start + Math.round(minutes);
  return end < 24 * 60 ? fromMinutes(end) : "";
}

/** Minutes between two "HH:MM" times, or null when end isn't after start. */
export function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return a != null && b != null && b > a ? b - a : null;
}

/** Nearest quarter hour, kept within the same day. */
export function roundToQuarterHour(time: string): string {
  const t = toMinutes(time);
  if (t == null) return "";
  return fromMinutes(Math.min(Math.round(t / 15) * 15, 23 * 60 + 45));
}

const STAGE_INTERVIEW_TYPE: Record<string, string> = {
  "New Lead": "phone_screen",
  Contacted: "phone_screen",
  "Phone Screen": "phone_screen",
  Interview: "in_person",
  "Shadow Day": "working_interview",
};

/** The interview a candidate at this stage is due for, if it's clear. */
export function interviewTypeForStage(stage: string | null | undefined): string | null {
  return (stage && STAGE_INTERVIEW_TYPE[stage.trim()]) || null;
}

/** Where an interview of this type happens. */
export function locationForType(type: string | null | undefined, clinic: string | null): string {
  switch (type) {
    case "phone_screen":
    case "doc_call":
      return PHONE_LOCATION;
    case "virtual":
      return VIDEO_LOCATION;
    case "in_person":
    case "working_interview":
    case "final":
      return clinic ?? "";
    default:
      return "";
  }
}

/** The job's clinic: the job opening's location, else the candidate's job location unless it's remote. */
export function interviewClinic(
  positionLocation: string | null | undefined,
  jobLocation: string | null | undefined,
): string | null {
  for (const loc of [positionLocation, jobLocation]) {
    const v = loc?.trim();
    if (v && !/remote/i.test(v)) return v;
  }
  return null;
}

/**
 * Form values for a new interview (`existing` null) or an existing one. An
 * existing interview keeps everything it records; only blanks are filled.
 */
export function prefillInterview(
  existing: Pick<
    PersonInterview,
    "interview_date" | "start_time" | "end_time" | "interview_type" | "interviewer" | "location"
  > | null,
  ctx: InterviewPrefillContext,
): InterviewFormValues {
  const myDuration = ctx.me?.defaultDuration || DEFAULT_INTERVIEW_MINUTES;

  if (existing) {
    const start = existing.start_time?.slice(0, 5) ?? "";
    const recordedEnd = existing.end_time?.slice(0, 5) ?? "";
    const duration = minutesBetween(start, recordedEnd) ?? myDuration;
    const type = existing.interview_type ?? "";
    return {
      interview_date: existing.interview_date ?? "",
      start_time: start,
      end_time: recordedEnd || addMinutesToTime(start, duration),
      interview_type: type,
      interviewer: existing.interviewer?.trim() || ctx.me?.name || "",
      location: existing.location?.trim() || locationForType(type, ctx.clinic),
      duration,
    };
  }

  const invite = ctx.pendingInvite;
  const type = invite?.interview_type || interviewTypeForStage(ctx.stage) || "";
  const duration = invite?.duration_minutes || myDuration;
  const start = roundToQuarterHour(ctx.now);
  return {
    interview_date: ctx.today,
    start_time: start,
    end_time: addMinutesToTime(start, duration),
    interview_type: type,
    interviewer: invite?.host_name?.trim() || ctx.me?.name || "",
    location: invite?.location?.trim() || locationForType(type, ctx.clinic),
    duration,
  };
}
