import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { MfaForm } from "./mfa-form";

export const dynamic = "force-dynamic";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const state = await getAuthState();
  if (state.kind === "anon") redirect("/login");
  if (state.kind === "not_gdo") redirect("/");

  const { setup } = await searchParams;
  const voluntary = setup === "1";
  if (state.kind === "ok" && !voluntary) redirect("/");

  const mode =
    state.kind === "mfa_challenge"
      ? "challenge"
      : state.verifiedFactorIds.length > 0
        ? "enabled"
        : "enroll";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white/90 p-8 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/80 backdrop-blur-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-2xl shadow-sm shadow-emerald-600/30">
            🔐
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Two-step verification
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "challenge"
              ? "Enter the 6-digit code from your authenticator app."
              : mode === "enabled"
                ? "Two-step verification is on for your account."
                : state.kind === "mfa_enroll"
                  ? "Your role requires an authenticator app. Set one up to continue."
                  : "Protect your account with an authenticator app."}
          </p>
        </div>

        {mode === "enabled" ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            You&apos;ll be asked for a code each time you sign in. If you lose
            your phone, ask an administrator to reset two-step verification.
          </p>
        ) : (
          <MfaForm
            mode={mode}
            factorId={mode === "challenge" ? state.verifiedFactorIds[0] : null}
          />
        )}

        <div className="mt-6 flex items-center justify-between text-xs">
          {state.kind === "ok" ? (
            <Link href="/" className="text-emerald-600 hover:underline">
              ← Back to Green Dog Ops
            </Link>
          ) : (
            <span />
          )}
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-slate-400 hover:text-slate-600">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
