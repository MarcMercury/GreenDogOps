"use client";

import type { SortDir } from "@/features/scheduling/attendance/types/attendance-sort";

/** A clickable column heading showing which way the table is sorted. */
export function AttendanceSortHeader({
  label,
  align = "left",
  active,
  dir,
  onClick,
}: {
  label: string;
  align?: "left" | "center";
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${
        align === "center" ? "text-center" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-slate-600 ${
          align === "center" ? "justify-center" : ""
        } ${active ? "text-slate-700" : ""}`}
      >
        {label}
        <span className="text-[0.65rem] leading-none">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
