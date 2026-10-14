/** Download the locked period's timecard totals; the route handler builds the file from the approval snapshots. */
export function ExportCsvForm({ periodStart }: { periodStart: string }) {
  return (
    <form action="/api/payroll/export" method="post">
      <input type="hidden" name="period" value={periodStart} />
      <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
        Export timecard totals (CSV)
      </button>
    </form>
  );
}
