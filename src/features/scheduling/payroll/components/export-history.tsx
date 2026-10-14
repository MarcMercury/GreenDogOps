import type { PayrollExportRow } from "@/features/scheduling/payroll/types/payroll-export";

/** Files already exported for this period, newest first. Renders nothing until the first export. */
export function ExportHistory({ exports }: { exports: PayrollExportRow[] }) {
  if (exports.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Export history</h2>
      <ul className="mt-2 space-y-1">
        {exports.map((e) => (
          <li key={e.id}>
            {new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} · {e.file_name} · {e.employee_count} employees ·{" "}
            {e.format} · SHA-256 {e.file_sha256.slice(0, 12)}…
          </li>
        ))}
      </ul>
    </section>
  );
}
