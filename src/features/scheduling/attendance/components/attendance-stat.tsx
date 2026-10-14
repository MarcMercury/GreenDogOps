import { Card, CardContent } from "@/components/ui/card";

/** One headline number above the Attendance & Reliability table. */
export function AttendanceStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
