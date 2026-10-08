import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/auth/session";
import { rateLimit, requestMeta } from "@/lib/security/rate-limit";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white/90 p-8 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-2xl shadow-sm shadow-emerald-600/30">
            🐾
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Green Dog Ops
          </h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <form action={signIn} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition hover:from-emerald-600 hover:to-emerald-700"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Access is managed by your administrator.{" "}
          <Link href="/" className="text-emerald-600 hover:underline">
            Need help?
          </Link>
        </p>
      </div>
    </main>
  );
}

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Throttle guessing: per account and per network, 15-minute windows. Sized
  // so a clinic full of staff behind one IP signing in at shift start passes.
  const meta = await requestMeta();
  const allowed =
    (await rateLimit(`login:email:${email.toLowerCase()}`, 10, 900)) &&
    (await rateLimit(`login:ip:${meta.ip}`, 60, 900));
  if (!allowed) {
    await recordAudit({
      actorId: null,
      actorEmail: email || null,
      action: "auth.login_throttled",
      entity: "auth",
      summary: "Sign-in blocked by rate limit",
      metadata: { ip: meta.ip, user_agent: meta.userAgent },
    });
    redirect(
      `/login?error=${encodeURIComponent("Too many sign-in attempts. Please wait 15 minutes and try again.")}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await recordAudit({
      actorId: null,
      actorEmail: email || null,
      action: "auth.login_failed",
      entity: "auth",
      summary: "Failed sign-in",
      metadata: { ip: meta.ip, user_agent: meta.userAgent, code: error.code ?? null },
    });
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  await recordAudit({
    actorId: data.user?.id ?? null,
    actorEmail: data.user?.email ?? email,
    action: "auth.login",
    entity: "auth",
    summary: "Signed in",
    metadata: { ip: meta.ip, user_agent: meta.userAgent },
  });
  redirect("/");
}
