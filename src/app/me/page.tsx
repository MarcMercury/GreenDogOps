import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRealAuthState } from "@/lib/auth/session";
import { NoAccess } from "../(app)/_components/no-access";

export const metadata: Metadata = { title: "My Green Dog — Green Dog Ops" };
export const dynamic = "force-dynamic";

/**
 * Self-service home (SELF_SERVICE_HOME). Employees land here and can reach
 * nothing else in Ops. Everything shown here must be loaded with the service
 * role and scoped to the signed-in person: the database does not treat an
 * Employee as a GDO user (migration 0238).
 */
export default async function SelfServiceHomePage() {
  const state = await getRealAuthState();
  if (state.kind === "anon") redirect("/login");
  if (state.kind === "mfa_challenge" || state.kind === "mfa_enroll") redirect("/login/mfa");
  if (state.kind === "not_gdo") return <NoAccess email={state.email} />;

  const { appUser, email } = state.current;
  const firstName = appUser.full_name?.split(" ")[0] ?? null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
          🐾
        </span>
        <h1 className="text-lg font-bold text-slate-900">
          {firstName ? `Hi ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your Green Dog employee portal is being set up. Clocking in and out,
          your schedule, your timecard and PTO requests will appear here.
        </p>
        <p className="mt-2 text-xs text-slate-400">Signed in as {email}</p>
        <div className="mt-6 space-y-2">
          {state.kind === "ok" ? (
            <Link
              href="/"
              className="block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Back to Green Dog Ops
            </Link>
          ) : null}
          <Link
            href="/login/mfa?setup=1"
            className="block text-xs text-emerald-700 hover:underline"
          >
            Two-step verification
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
