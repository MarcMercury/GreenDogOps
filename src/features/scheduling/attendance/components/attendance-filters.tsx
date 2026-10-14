"use client";

/** Search box and the "only with recorded attendance" cut, above the table. */
export function AttendanceFilters({
  query,
  onQueryChange,
  onlyResolved,
  onOnlyResolvedChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onlyResolved: boolean;
  onOnlyResolvedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search employees…"
        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={onlyResolved}
          onChange={(e) => onOnlyResolvedChange(e.target.checked)}
        />
        Only with recorded attendance
      </label>
    </div>
  );
}
