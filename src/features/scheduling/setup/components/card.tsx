/** The white panel every Set Up tab is laid out in. */
export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {children}
    </div>
  );
}
