// ---------------------------------------------------------------------------
// Rejections: rejecting a candidate schedules a template email 48 hours out.
// Until it sends, the email can be cancelled or the rejection undone (the
// Rejected queue). Pure helpers shared by the actions, the cron and the UI.
// ---------------------------------------------------------------------------

export const REJECTION_DELAY_HOURS = 48;

export type RejectedFrom = "review" | "forms" | "interviews" | "profile";

export const REJECTED_FROM_LABELS: Record<RejectedFrom, string> = {
  review: "Review Queue",
  forms: "Form Responses",
  interviews: "Interviews",
  profile: "Candidate profile",
};

export type RejectionEmailStatus = "scheduled" | "sending" | "sent" | "cancelled" | "not_sending" | "failed";

export const REJECTION_EMAIL_STATUS_LABELS: Record<RejectionEmailStatus, string> = {
  scheduled: "Waiting — 48 hours",
  sending: "Sending…",
  sent: "Email sent",
  cancelled: "Email cancelled",
  not_sending: "No email",
  failed: "Email failed",
};

export const REJECTION_EMAIL_STATUS_BADGE: Record<RejectionEmailStatus, string> = {
  scheduled: "bg-amber-100 text-amber-800",
  sending: "bg-sky-100 text-sky-800",
  sent: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-600",
  not_sending: "bg-slate-100 text-slate-500",
  failed: "bg-rose-100 text-rose-700",
};

export interface EmailTemplate {
  id: string;
  kind: "rejection";
  name: string;
  subject: string;
  body: string;
  active: boolean;
  sort_order: number;
}

export interface Rejection {
  id: string;
  person_id: string;
  rejected_from: RejectedFrom;
  prev_stage: string | null;
  prev_review_status: string | null;
  rejected_stage: string | null;
  rejected_by_name: string | null;
  rejected_at: string;
  send_email: boolean;
  template_id: string | null;
  template_name: string | null;
  email_to: string | null;
  email_scheduled_for: string | null;
  email_status: RejectionEmailStatus;
  email_sent_at: string | null;
  email_error: string | null;
  undone_at: string | null;
}

export interface TemplateVars {
  first_name: string | null;
  full_name: string | null;
  role: string | null;
}

/** Fill {first_name}, {full_name} and {role}; unknown placeholders are left alone. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  const values: Record<string, string> = {
    first_name: vars.first_name?.trim() || "there",
    full_name: vars.full_name?.trim() || vars.first_name?.trim() || "there",
    role: vars.role?.trim() || "open",
  };
  return text.replace(/\{(first_name|full_name|role)\}/g, (_, k: string) => values[k]);
}

/** The template a rejection from this point most likely wants. */
export function suggestedTemplate(
  templates: Pick<EmailTemplate, "id" | "name" | "active">[],
  from: RejectedFrom,
  hadInterview: boolean,
): string | null {
  const active = templates.filter((t) => t.active);
  const want = hadInterview || from === "interviews" ? /interview/i : from === "forms" ? /screen/i : /application|initial/i;
  return (active.find((t) => want.test(t.name)) ?? active[0])?.id ?? null;
}

/** "in 31h" / "in 45m" / "due now" until the email goes out. */
export function countdown(due: string | null, now = new Date()): string | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `in ${h}h`;
  return `in ${Math.max(1, Math.round(ms / 60000))}m`;
}

/** Undo is allowed until the email has actually gone out. */
export function canUndoRejection(r: Pick<Rejection, "email_status" | "undone_at">): boolean {
  return !r.undone_at && r.email_status !== "sent" && r.email_status !== "sending";
}

/** Clamp a Candidate Score to 0–10 with one decimal; null when blank/invalid. */
export function cleanScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}
