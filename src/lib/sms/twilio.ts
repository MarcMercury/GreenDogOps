import "server-only";

// ---------------------------------------------------------------------------
// Twilio Programmable Messaging over the REST API (fetch, no SDK — same style
// as the Resend wrapper in src/lib/shared/email.ts).
//
// Env (Vercel / .env.local):
//   TWILIO_ACCOUNT_SID            AC…
//   TWILIO_AUTH_TOKEN             also the key for webhook signatures
//   TWILIO_MESSAGING_SERVICE_SID  MG… — holds the A2P-registered number
//   SMS_LIVE                      "true" to text anyone with consent; otherwise
//   SMS_TEST_NUMBERS              only these numbers (comma separated)
//
// Sends are never retried: a timeout may still have delivered the text, and a
// duplicate text is worse than a failed one (staff can resend).
// ---------------------------------------------------------------------------

const API = "https://api.twilio.com/2010-04-01";
const SEND_TIMEOUT_MS = 10_000;

interface TwilioCreds {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
}

function creds(): TwilioCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  return accountSid && authToken && messagingServiceSid ? { accountSid, authToken, messagingServiceSid } : null;
}

export function isSmsConfigured(): boolean {
  return creds() !== null;
}

export function twilioAuthToken(): string | null {
  return creds()?.authToken ?? null;
}

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; error: string; code?: string };

export async function sendTwilioMessage(input: {
  to: string;
  body: string;
  statusCallback: string | null;
}): Promise<TwilioSendResult> {
  const c = creds();
  if (!c) return { ok: false, error: "Texting isn't set up yet (Twilio credentials missing)." };

  const form = new URLSearchParams({ To: input.to, Body: input.body, MessagingServiceSid: c.messagingServiceSid });
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback);

  try {
    const res = await fetch(`${API}/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as
      | { sid?: string; status?: string; message?: string; code?: number }
      | null;
    if (!res.ok || !data?.sid) {
      return {
        ok: false,
        error: `Twilio error: ${data?.message ?? `HTTP ${res.status}`}`,
        ...(data?.code ? { code: String(data.code) } : {}),
      };
    }
    return { ok: true, sid: data.sid, status: data.status ?? "queued" };
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? "Twilio didn't answer in time. Check the thread before resending — the text may still arrive."
        : `Couldn't reach Twilio: ${(err as Error).message}`,
    };
  }
}
