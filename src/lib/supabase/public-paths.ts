/**
 * Paths reachable without a Supabase session. Everything else is redirected to
 * /login by the proxy (./proxy.ts). Each entry must authenticate some other way
 * (CRON_SECRET, a webhook signature, or an opaque token in the path) — or be
 * genuinely public. Every Vercel cron path must be listed here, or the cron is
 * redirected to /login and never runs (public-paths.test.ts checks vercel.json).
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/ce/signup") ||
    // Retail lead capture form behind a Non-Med Partner's QR code. Gated by the
    // opaque qr_token in the path, not by a session.
    pathname.startsWith("/lead/") ||
    // Event / promo / partner QR capture forms. Same rule: the opaque token in
    // the path is the only credential, and it resolves to one QR code.
    pathname.startsWith("/q/") ||
    // Recruiting: the public Standard Application, and the questionnaire and
    // interview-scheduling links sent to one candidate (opaque token only).
    pathname === "/apply" ||
    pathname.startsWith("/apply/") ||
    pathname.startsWith("/forms/") ||
    pathname.startsWith("/book/") ||
    // Public legal pages (linked from the Google OAuth consent screen).
    pathname === "/privacy" ||
    pathname === "/terms" ||
    // Cron endpoint: self-authenticates via the CRON_SECRET bearer token.
    pathname.startsWith("/api/calendar/sync") ||
    // Admin user-roster sync cron endpoint self-authenticates via CRON_SECRET.
    pathname.startsWith("/api/admin/users/roster-sync") ||
    // Slack user sync cron endpoint self-authenticates via CRON_SECRET.
    pathname === "/api/admin/slack/sync" ||
    // Medical Boards daily rollover cron self-authenticates via CRON_SECRET.
    pathname.startsWith("/api/med-ops/boards/rollover") ||
    // ATS intake endpoints self-authenticate: the Gmail cron via CRON_SECRET,
    // the Indeed Apply webhook via its X-Indeed-Signature HMAC, and the ZIP →
    // city lookup via the signed-in user's session (getCurrentUser).
    pathname.startsWith("/api/ats/") ||
    // Agent endpoints self-authenticate via the CRON_SECRET bearer token
    // (worker run status, ezyVet data sinks, run creation).
    pathname.startsWith("/api/agents/") ||
    // Resend webhook self-authenticates via its Svix signature (whsec_…).
    pathname.startsWith("/api/email/webhook") ||
    // Twilio SMS webhooks self-authenticate via X-Twilio-Signature.
    pathname.startsWith("/api/sms/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}
