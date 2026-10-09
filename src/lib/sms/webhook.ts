import "server-only";
import type { NextRequest } from "next/server";
import { appBaseUrl } from "@/lib/ats/slack-notify";
import { twilioAuthToken } from "./twilio";
import { isValidTwilioSignature } from "./signature";

export type VerifiedTwilioRequest =
  | { ok: true; params: Record<string, string> }
  | { ok: false; status: 403 | 503 };

/**
 * Read a Twilio webhook POST and check X-Twilio-Signature. Twilio signs the URL
 * it was configured with, i.e. the public APP_BASE_URL address — not the
 * internal Vercel host — so the URL is rebuilt from appBaseUrl().
 */
export async function verifyTwilioRequest(req: NextRequest): Promise<VerifiedTwilioRequest> {
  const token = twilioAuthToken();
  if (!token) return { ok: false, status: 503 };
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  const url = `${appBaseUrl()}${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (!isValidTwilioSignature(token, url, params, req.headers.get("x-twilio-signature"))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, params };
}
