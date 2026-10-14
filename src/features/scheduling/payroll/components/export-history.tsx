import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PayrollExportRow } from "@/features/scheduling/payroll/types/payroll-export";

/** Files already exported for this period, newest first. Renders nothing until the first export. */
export function ExportHistory({ exports }: { exports: PayrollExportRow[] }) {
  if (exports.length === 0) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Export history</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {exports.map((e) => (
            <li key={e.id}>
              {new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} · {e.file_name} · {e.employee_count} employees ·{" "}
              {e.format} · SHA-256 {e.file_sha256.slice(0, 12)}…
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
