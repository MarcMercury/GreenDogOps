import { NextResponse, type NextRequest } from "next/server";
import { getRealAuthState, recordAudit } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canUseViewAs,
  parseViewAsTarget,
  PREVIEWABLE_ROLES,
  safeReturnPath,
  serializeViewAsTarget,
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE_SECONDS,
  type ViewAsUserOption,
} from "@/lib/auth/view-as";

export const runtime = "nodejs";

/**
 * Same rule Next.js applies to Server Actions: the Origin header's host must
 * equal the forwarded host (or Host). A missing Origin is refused.
 */
function isSameOriginPost(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))
    ?.split(",")[0]
    .trim();
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The real signed-in Owner, or null. Never the previewed user. */
async function realOwner() {
  const state = await getRealAuthState();
  if (state.kind !== "ok" || !canUseViewAs(state.current.appUser)) return null;
  return state.current;
}

/** GET /api/view-as → the active users and roles an Owner can preview. */
export async function GET() {
  const owner = await realOwner();
  if (!owner) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { data, error } = await createAdminClient()
    .from("app_user")
    .select("id, email, full_name, title, role")
    .eq("is_active", true)
    .neq("id", owner.appUser.id)
    .order("full_name", { ascending: true, nullsFirst: false });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, users: (data ?? []) as ViewAsUserOption[], roles: PREVIEWABLE_ROLES },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * POST /api/view-as (form post) → start or stop a preview, then 303 back to
 * `returnTo` so the page re-renders as a normal GET.
 *   target = "user:<id>" | "role:<role>"  — start (Owners only)
 *   target = "self" (or empty)             — stop (always allowed)
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  let destination = new URL(safeReturnPath(String(form.get("returnTo") ?? "/")), request.url);
  if (destination.origin !== request.nextUrl.origin) destination = new URL("/", request.url);
  const rawTarget = String(form.get("target") ?? "");
  const response = NextResponse.redirect(destination, { status: 303 });

  const state = await getRealAuthState();
  const actor = state.kind === "ok" ? state.current : null;

  // Switching back must never depend on the previewed user's access — or even
  // on still being an Owner — so clearing the preview is always allowed.
  if (rawTarget === "" || rawTarget === "self") {
    const had = request.cookies.get(VIEW_AS_COOKIE)?.value ?? null;
    response.cookies.delete(VIEW_AS_COOKIE);
    if (actor && had) {
      await recordAudit({
        actorId: actor.authId,
        actorEmail: actor.email,
        action: "view_as.stop",
        entity: "app_user",
        summary: "Switched back to own view",
        metadata: { previous: had },
      });
    }
    return response;
  }

  // Starting a preview requires a same-origin form post (browsers always send
  // Origin on POST; the session cookie is SameSite=Lax as well). Stopping above
  // is deliberately exempt: clearing the preview is harmless and must not fail.
  if (!isSameOriginPost(request) || !actor || !canUseViewAs(actor.appUser)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const target = parseViewAsTarget(rawTarget);
  if (!target) {
    return NextResponse.json({ ok: false, error: "invalid target" }, { status: 400 });
  }

  let summary: string;
  if (target.kind === "user") {
    if (target.userId === actor.appUser.id) {
      response.cookies.delete(VIEW_AS_COOKIE);
      return response;
    }
    const { data } = await createAdminClient()
      .from("app_user")
      .select("id, email, role, is_active")
      .eq("id", target.userId)
      .maybeSingle();
    if (!data || !data.is_active) {
      return NextResponse.json({ ok: false, error: "user not found or inactive" }, { status: 404 });
    }
    summary = `Viewing as ${data.email} (${data.role})`;
  } else {
    summary = `Viewing as role ${target.role}`;
  }

  response.cookies.set(VIEW_AS_COOKIE, serializeViewAsTarget(target), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: VIEW_AS_MAX_AGE_SECONDS,
  });
  await recordAudit({
    actorId: actor.authId,
    actorEmail: actor.email,
    action: "view_as.start",
    entity: "app_user",
    entityId: target.kind === "user" ? target.userId : undefined,
    summary,
    metadata: { target: serializeViewAsTarget(target) },
  });
  return response;
}
