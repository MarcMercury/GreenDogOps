import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/auth/session";
import { requestMeta } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const meta = await requestMeta();
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: "auth.logout",
      entity: "auth",
      summary: "Signed out",
      metadata: { ip: meta.ip, user_agent: meta.userAgent },
    });
  }
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
