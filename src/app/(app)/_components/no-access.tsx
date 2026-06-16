/** Shown when a signed-in user is not an authorized Green Dog Ops user. */
export function NoAccess({ email }: { email: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
          🔒
        </span>
        <h1 className="text-lg font-bold text-slate-900">Access pending</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account{email ? ` (${email})` : ""} isn&apos;t authorized for
          Green Dog Ops yet. An administrator needs to grant you access.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
