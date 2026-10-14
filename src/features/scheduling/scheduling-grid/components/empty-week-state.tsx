/** The grid page's body when no schedule week exists yet (or the requested one is gone). */
export function EmptyWeekState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm text-slate-500">
        No schedule week yet. Pick a week above to create one.
      </p>
    </div>
  );
}
