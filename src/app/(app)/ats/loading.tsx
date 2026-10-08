export default function AtsLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-busy="true" aria-label="Loading recruiting">
      <div className="mb-6 flex items-center gap-3">
        <span className="text-2xl">🎯</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recruiting</p>
          <h1 className="text-2xl font-semibold text-slate-900">Recruiting (ATS)</h1>
        </div>
      </div>
      <div className="mb-4 flex gap-4 border-b border-slate-200 pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-5 w-24 rounded bg-slate-200" />
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="h-14 rounded-xl bg-slate-100" />
      <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
