import { Button } from "@/components/ui/button";

/**
 * Download the locked period's timecard totals; the route handler builds the
 * file from the approval snapshots. A plain HTML form on purpose: the response
 * is a file, which a Server Action cannot hand to the browser.
 */
export function ExportCsvForm({ periodStart }: { periodStart: string }) {
  return (
    <form action="/api/payroll/export" method="post">
      <input type="hidden" name="period" value={periodStart} />
      <Button type="submit">Export timecard totals (CSV)</Button>
    </form>
  );
}
