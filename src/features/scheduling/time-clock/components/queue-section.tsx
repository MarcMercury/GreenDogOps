/** One approver queue: a titled card with a count pill and a lookback hint. */
export function QueueSection({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          {title}{" "}
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
            {count}
          </span>
        </h2>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
