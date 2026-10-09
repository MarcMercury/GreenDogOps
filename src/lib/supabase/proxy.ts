import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PATHNAME_HEADER } from "@/lib/auth/permissions";
import { DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { isPublicPath } from "./public-paths";

/**
 * Refreshes the Supabase auth session on every request and keeps cookies in
 * sync. Called from the root `proxy.ts` (Next.js 16 renamed middleware -> proxy).
 *
 * Also performs an optimistic auth gate: unauthenticated users are redirected
 * to /login. This only proves "has a session on the shared Supabase project";
 * it does NOT prove the visitor is a Green Dog Ops user. Two further layers do:
 *   - RLS on the `greendogops` schema (migration 0164) restricts every table to
 *     an active `app_user` via greendogops.is_gdo_user().
 *   - src/lib/auth/session.ts (requireUser / requireAdmin / ensureCanEdit) and
 *     canAccessModule() enforce module- and field-level permissions.
 */
export async function updateSession(request: NextRequest) {
  // Server Components cannot read the request path, so publish it as a header
  // for (app)/layout.tsx to gate on. Always overwrite: a client could otherwise
  // spoof it to reach a module it lacks. Re-read `request.headers` each time so
  // cookies refreshed by setAll() below are carried through.
  const forwardHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

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
        response = NextResponse.next({ request: { headers: forwardHeaders() } });
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
  const isPublic = isPublicPath(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
