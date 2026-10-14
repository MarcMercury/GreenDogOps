/** One headline number on a clinic's day card. */
export function Stat({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone || "text-foreground"}`}>{value}</p>
    </div>
  );
}
