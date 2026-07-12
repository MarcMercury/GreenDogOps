import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Refreshes the Supabase auth session on every request and keeps cookies in
 * sync. Called from the root `proxy.ts` (Next.js 16 renamed middleware -> proxy).
 *
 * Also performs an optimistic auth gate: unauthenticated users are redirected
 * to /login. Real authorization (module/field-level) is enforced by RLS on the
 * isolated `greendogops` schema, not here.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/ce/signup") ||
    // Cron endpoint: self-authenticates via the CRON_SECRET bearer token.
    pathname.startsWith("/api/calendar/sync") ||
    // ATS intake endpoints self-authenticate: the Gmail cron via CRON_SECRET,
    // the Indeed Apply webhook via its X-Indeed-Signature HMAC.
    pathname.startsWith("/api/ats/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
