import "server-only";

// ---------------------------------------------------------------------------
// Transactional email via Resend.
//
// A thin, dependency-free wrapper over the Resend REST API (https://resend.com)
// so any module in the Ops app can send email with one call. We use `fetch`
// rather than the SDK to keep the bundle small and match the app's other
// integrations (Gmail, Slack).
//
// Required env:
//   RESEND_API_KEY     — server-side API key (see .env.local / Vercel).
//   RESEND_FROM_EMAIL  — default From header, e.g. `GreenDog Ops <ops@…>`.
//                        The domain must be verified in the Resend dashboard
//                        before mail from it will deliver; until then use the
//                        sandbox address `onboarding@resend.dev`.
// ---------------------------------------------------------------------------

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailInput {
  /** Recipient(s). */
  to: string | string[];
  subject: string;
  /** HTML body. Provide this and/or `text`. */
  html?: string;
  /** Plain-text body. Provide this and/or `html`. */
  text?: string;
  /** Overrides RESEND_FROM_EMAIL for this message. */
  from?: string;
  /** Reply-To header(s). */
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  /** Resend tags for analytics/filtering. */
  tags?: { name: string; value: string }[];
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend message id, when the send succeeded. */
  id?: string;
  error?: string;
}

/** True when the Resend API key is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send a transactional email through Resend.
 *
 * Never throws — failures (missing config, API errors, network) are returned as
 * `{ ok: false, error }` so callers can log and continue.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Email is not configured. Set RESEND_API_KEY in .env.local / Vercel.",
    };
  }

  const from = input.from ?? process.env.RESEND_FROM_EMAIL;
  if (!from) {
    return {
      ok: false,
      error:
        "No From address. Set RESEND_FROM_EMAIL in .env.local / Vercel, or pass `from`.",
    };
  }

  if (!input.html && !input.text) {
    return { ok: false, error: "Email requires an `html` or `text` body." };
  }

  const payload: Record<string, unknown> = {
    from,
    to: input.to,
    subject: input.subject,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;
  if (input.cc) payload.cc = input.cc;
  if (input.bcc) payload.bcc = input.bcc;
  if (input.tags?.length) payload.tags = input.tags;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!res.ok) {
      const detail = data?.message || data?.name || `HTTP ${res.status}`;
      return { ok: false, error: `Resend error: ${detail}` };
    }

    return { ok: true, id: data?.id };
  } catch (err) {
    return {
      ok: false,
      error: `Resend request failed: ${(err as Error).message}`,
    };
  }
}
