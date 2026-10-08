import "server-only";
import { sendEmail, type SendEmailResult } from "@/lib/shared/email";

// ---------------------------------------------------------------------------
// Candidate-facing recruiting emails: questionnaire links, "pick a time"
// scheduling links and booking confirmations. Plain, branded HTML with a
// text fallback; every link is unique to the candidate.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#047857;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:12px;color:#64748b">Or open this link: <a href="${escapeHtml(button.url)}" style="color:#047857">${escapeHtml(button.url)}</a></p>`
    : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
  <p style="margin:0 0 20px;font-weight:700;color:#047857;font-size:18px">Green Dog</p>
  ${body}${cta}
  <p style="margin:24px 0 0;color:#475569">— The Green Dog Team</p>
</div>`;
}

function text(paragraphs: string[], button?: { label: string; url: string }): string {
  return [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : []), "— The Green Dog Team"].join("\n\n");
}

export async function sendQuestionnaireEmail(input: {
  to: string;
  firstName: string | null;
  formName: string;
  url: string;
}): Promise<SendEmailResult> {
  const hi = `Hi ${input.firstName?.trim() || "there"},`;
  const paragraphs = [
    hi,
    "Thanks for your interest in Green Dog. We'd like to learn a little more about you before scheduling your first interview. Please complete the following short questionnaire:",
    input.formName,
  ];
  const button = { label: "Complete Questionnaire", url: input.url };
  return sendEmail({
    to: input.to,
    subject: `Green Dog — ${input.formName}`,
    html: layout(paragraphs, button),
    text: text(paragraphs, button),
    tags: [{ name: "category", value: "recruiting_form" }],
  });
}

export async function sendSchedulingInviteEmail(input: {
  to: string;
  firstName: string | null;
  headline: string;
  message: string | null;
  url: string;
}): Promise<SendEmailResult> {
  const paragraphs = [
    `Hi ${input.firstName?.trim() || "there"},`,
    input.headline,
    ...(input.message?.trim() ? [input.message.trim()] : []),
    "Choose a time that works for you — no account needed.",
  ];
  const button = { label: "Choose a time", url: input.url };
  return sendEmail({
    to: input.to,
    subject: input.headline,
    html: layout(paragraphs, button),
    text: text(paragraphs, button),
    tags: [{ name: "category", value: "recruiting_schedule" }],
  });
}

export async function sendBookingConfirmationEmail(input: {
  to: string;
  firstName: string | null;
  title: string;
  when: string;
  withName: string | null;
  location: string | null;
  /** Attach an .ics when Google isn't sending the invite. */
  ics: string | null;
  googleInviteSent: boolean;
}): Promise<SendEmailResult> {
  const paragraphs = [
    `Hi ${input.firstName?.trim() || "there"},`,
    `You're confirmed for your ${input.title.toLowerCase()} with Green Dog.`,
    [
      `When: ${input.when}`,
      input.withName ? `With: ${input.withName}` : null,
      input.location ? `Where: ${input.location}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    input.googleInviteSent
      ? "A calendar invitation is on its way from Google Calendar."
      : "The calendar invitation is attached.",
    "If you need to change the time, just reply to this email.",
  ];
  return sendEmail({
    to: input.to,
    subject: `Confirmed: ${input.title} with Green Dog — ${input.when}`,
    html: layout(paragraphs),
    text: text(paragraphs),
    tags: [{ name: "category", value: "recruiting_booking" }],
    ...(input.ics
      ? {
          attachments: [
            {
              filename: "interview.ics",
              content: Buffer.from(input.ics, "utf-8").toString("base64"),
              contentType: "text/calendar; charset=utf-8; method=PUBLISH",
            },
          ],
        }
      : {}),
  });
}

/** Tell an interviewer without a connected calendar about a booking. */
export async function sendInterviewerBookingEmail(input: {
  to: string;
  candidateName: string;
  title: string;
  when: string;
  profileUrl: string;
  ics: string;
}): Promise<SendEmailResult> {
  const paragraphs = [
    `${input.candidateName} booked a ${input.title.toLowerCase()} with you.`,
    `When: ${input.when}`,
    "Connect your Google Calendar in Ops (Recruiting → My Availability) so bookings land on your calendar automatically.",
  ];
  const button = { label: "Open candidate in Ops", url: input.profileUrl };
  return sendEmail({
    to: input.to,
    subject: `Booked: ${input.title} with ${input.candidateName} — ${input.when}`,
    html: layout(paragraphs, button),
    text: text(paragraphs, button),
    attachments: [
      {
        filename: "interview.ics",
        content: Buffer.from(input.ics, "utf-8").toString("base64"),
        contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      },
    ],
  });
}
