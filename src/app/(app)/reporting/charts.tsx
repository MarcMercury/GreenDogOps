// Pure presentational pieces for the Reporting + ezyVet pages. No client state,
// so these render on the server.

import type { LocationKey } from "@/lib/reporting/types";
import { LOCATION_COLORS } from "@/lib/reporting/types";

export function fmtCurrency(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtNumber(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

export function fmtMonth(iso: string): string {
  // iso = "YYYY-MM-DD" (first of month)
  const [y, m] = iso.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" },
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent = "emerald",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "indigo" | "sky" | "amber" | "slate";
}) {
  const accents: Record<string, string> = {
    emerald: "text-emerald-600",
    indigo: "text-indigo-600",
    sky: "text-sky-600",
    amber: "text-amber-600",
    slate: "text-slate-600",
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accents[accent]}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bar list — a label, a value, and a proportional bar. */
export function BarList({
  items,
}: {
  items: { label: string; value: number; display: string; color?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{it.label}</span>
            <span className="tabular-nums text-slate-500">{it.display}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.value / max) * 100}%`,
                backgroundColor: it.color ?? "#10b981",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical grouped bars for a monthly trend (one metric). */
export function MonthlyBars({
  data,
  valueKey,
  format,
  color = "#10b981",
  max: maxOverride,
}: {
  data: { month: string; [k: string]: string | number }[];
  valueKey: string;
  format: (n: number) => string;
  color?: string;
  /** Optional shared scale, so small multiples are comparable. */
  max?: number;
}) {
  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const max = Math.max(1, maxOverride ?? 0, ...values);
  if (data.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 160 }}>
      {data.map((d) => {
        const v = Number(d[valueKey] ?? 0);
        const h = Math.max(2, Math.round((v / max) * 130));
        return (
          <div key={d.month} className="flex min-w-[42px] flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium tabular-nums text-slate-500">
              {format(v)}
            </span>
            <div
              className="w-full rounded-t-md"
              style={{ height: h, backgroundColor: color }}
              title={`${d.month}: ${format(v)}`}
            />
            <span className="text-[10px] font-medium text-slate-400">
              {fmtMonth(d.month)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stacked monthly bars segmented by clinic location. Each month is one column;
 * within it, segments are stacked per location and colored by LOCATION_COLORS.
 */
export function StackedMonthlyBars({
  rows,
  metric,
  format,
}: {
  rows: {
    month: string;
    location_key: LocationKey;
    location_label: string;
    appointments: number;
    revenue: number;
  }[];
  metric: "appointments" | "revenue";
  format: (n: number) => string;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-slate-400">No data yet.</p>;

  const months = [...new Set(rows.map((r) => r.month))].sort();
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byMonth.get(r.month) ?? [];
    arr.push(r);
    byMonth.set(r.month, arr);
  }

  const totals = months.map((m) =>
    (byMonth.get(m) ?? []).reduce((s, r) => s + Number(r[metric] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);

  // Stable, sorted legend across all locations present.
  const legend = [...new Set(rows.map((r) => r.location_key))]
    .map((key) => ({
      key,
      label: rows.find((r) => r.location_key === key)?.location_label ?? key,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <div
        className="flex items-end gap-2 overflow-x-auto pb-1"
        style={{ minHeight: 170 }}
      >
        {months.map((m, i) => {
          const segs = (byMonth.get(m) ?? [])
            .slice()
            .sort((a, b) => a.location_label.localeCompare(b.location_label));
          const colH = Math.max(2, Math.round((totals[i] / max) * 135));
          return (
            <div
              key={m}
              className="flex min-w-[46px] flex-1 flex-col items-center gap-1"
            >
              <span className="text-[10px] font-medium tabular-nums text-slate-500">
                {format(totals[i])}
              </span>
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: colH }}
                title={`${m}: ${format(totals[i])}`}
              >
                {segs.map((seg) => {
                  const v = Number(seg[metric] ?? 0);
                  const segH = totals[i] > 0 ? (v / totals[i]) * 100 : 0;
                  return (
                    <div
                      key={seg.location_key}
                      style={{
                        height: `${segH}%`,
                        backgroundColor:
                          LOCATION_COLORS[seg.location_key] ?? "#94a3b8",
                      }}
                      title={`${seg.location_label}: ${format(v)}`}
                    />
                  );
                })}
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                {fmtMonth(m)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: LOCATION_COLORS[l.key] ?? "#94a3b8" }}
            />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

