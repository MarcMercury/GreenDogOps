"use client";

import { useRouter } from "next/navigation";

/** Date + location + department lookup for the Board Archive. */
export function ArchivePicker({
  locations,
  boards,
  date,
  location,
  board,
}: {
  locations: { slug: string; label: string }[];
  boards: { key: string; label: string }[];
  date: string;
  location: string;
  board: string;
}) {
  const router = useRouter();

  const go = (next: { date?: string; location?: string; board?: string }) => {
    const params = new URLSearchParams();
    const d = next.date ?? date;
    const l = next.location ?? location;
    const b = next.board ?? board;
    if (d) params.set("date", d);
    if (l) params.set("location", l);
    if (b) params.set("board", b);
    router.push(`/med-ops/board-archive?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Date
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => go({ date: e.target.value })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Location
        </span>
        <select
          value={location}
          onChange={(e) => go({ location: e.target.value })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
        >
          <option value="">Select…</option>
          {locations.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Department
        </span>
        <select
          value={board}
          onChange={(e) => go({ board: e.target.value })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
        >
          <option value="">Select…</option>
          {boards.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
