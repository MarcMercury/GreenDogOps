/**
 * The card a gated Scheduling page shows instead of its content when the
 * signed-in role may not open it (Time Clock, Time & Attendance, Payroll).
 */
export function RestrictedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
      {children}
    </div>
  );
}
