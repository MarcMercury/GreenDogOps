/** One headline number on a clinic's day card. */
export function Stat({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone || "text-slate-900"}`}>{value}</p>
    </div>
  );
}
