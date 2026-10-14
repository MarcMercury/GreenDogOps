/**
 * The schedule page's two columns: the Weeks / Rows cards on the left, the
 * week itself on the right. The sidebar stays put while the grid scrolls.
 */
export function SchedulePageShell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[21rem_minmax(0,1fr)] print:block">
      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start print:hidden">{sidebar}</aside>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
