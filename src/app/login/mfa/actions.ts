"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthState, recordAudit } from "@/lib/auth/session";
import { rateLimit, requestMeta } from "@/lib/security/rate-limit";

export type EnrollStart =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string };

export type VerifyResult = { ok: true } | { ok: false; error: string };

const CODE_RE = /^\d{6}$/;

/** Signed-in GDO user (any MFA state), or null. */
async function signedInGdoUser() {
  const state = await getAuthState();
  if (state.kind === "anon" || state.kind === "not_gdo") return null;
  return state;
}

/** Begin TOTP enrollment: returns the QR code and secret to scan. */
export async function startMfaEnrollment(): Promise<EnrollStart> {
  const state = await signedInGdoUser();
  if (!state) return { ok: false, error: "You are not signed in." };
  if (state.verifiedFactorIds.length > 0) {
    return { ok: false, error: "Two-step verification is already set up." };
  }
  if (!(await rateLimit(`mfa:enroll:${state.current.authId}`, 10, 900))) {
    return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  }

  const supabase = await createClient();
  // Clear abandoned, never-verified attempts so a retry starts clean.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Green Dog Ops ${new Date().toISOString().slice(0, 16)}`,
    issuer: "Green Dog Ops",
  });
  if (error || !data) {
    console.error("[mfa] enroll failed:", error?.message);
    return { ok: false, error: "Could not start setup. Please try again." };
  }
  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

async function verify(
  factorId: string,
  code: string,
  purpose: "enroll" | "challenge",
): Promise<VerifyResult> {
  const state = await signedInGdoUser();
  if (!state) return { ok: false, error: "You are not signed in." };
  const cleaned = code.replace(/\s+/g, "");
  if (!CODE_RE.test(cleaned)) {
    return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  }
  if (purpose === "challenge" && !state.verifiedFactorIds.includes(factorId)) {
    return { ok: false, error: "Unknown verification method." };
  }
  if (!(await rateLimit(`mfa:verify:${state.current.authId}`, 8, 600))) {
    return { ok: false, error: "Too many attempts. Please wait 10 minutes and try again." };
  }

  const meta = await requestMeta();
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleaned });
  if (error) {
    await recordAudit({
      actorId: state.current.authId,
      actorEmail: state.current.email,
      action: purpose === "enroll" ? "auth.mfa_enroll_failed" : "auth.mfa_failed",
      entity: "auth",
      summary: "Incorrect two-step verification code",
      metadata: { ip: meta.ip, user_agent: meta.userAgent },
    });
    return { ok: false, error: "That code didn't match. Check your app and try again." };
  }

  await recordAudit({
    actorId: state.current.authId,
    actorEmail: state.current.email,
    action: purpose === "enroll" ? "auth.mfa_enrolled" : "auth.mfa_verified",
    entity: "auth",
    summary:
      purpose === "enroll"
        ? "Set up two-step verification"
        : "Completed two-step verification",
    metadata: { ip: meta.ip, user_agent: meta.userAgent },
  });
  return { ok: true };
}

/** Confirm a new authenticator with its first code. */
export async function confirmMfaEnrollment(factorId: string, code: string): Promise<VerifyResult> {
  return verify(factorId, code, "enroll");
}

/** Sign-in step two: verify a code for an enrolled authenticator. */
export async function verifyMfaCode(factorId: string, code: string): Promise<VerifyResult> {
  return verify(factorId, code, "challenge");
}
