"use client";

/**
 * Shared data-grid primitives used by EVERY module list view (HR Roster, ATS,
 * and all CRMs). Centralizing them here guarantees a uniform header, summary
 * bubbles, search + filter bar, and sortable columns — same colors, fonts,
 * spacing and behavior across the whole app.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
// ---------------------------------------------------------------------------
// Number / text helpers
// ---------------------------------------------------------------------------
export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function compactCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n)}`;
}

// ---------------------------------------------------------------------------
// Summary bubbles
// ---------------------------------------------------------------------------
export type Stat = { label: string; value: string; tone?: string };

export function StatCard({ label, value, tone }: Stat) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${tone ?? "text-slate-900"}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <StatCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------
export function Pill({
  text,
  styles,
}: {
  text: string;
  styles: Record<string, string>;
}) {
  const key = text.toLowerCase();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        styles[key] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------
function csvCell(v: unknown): string {
  const s =
    v === null || v === undefined
      ? ""
      : typeof v === "boolean"
        ? v
          ? "yes"
          : "no"
        : String(v);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

/** Trigger a client-side CSV download from header + value rows. */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: unknown[][],
) {
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export a set of columns + rows to CSV using each column's header/value. */
export function exportColumnsCsv<T>(
  filename: string,
  columns: { header: string; value: (row: T) => unknown }[],
  rows: T[],
) {
  downloadCsv(
    filename,
    columns.map((c) => c.header),
    rows.map((r) => columns.map((c) => c.value(r))),
  );
}

/** Minimal CSV parser (handles quoted fields + escaped quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Parse a picked CSV file and report a preview summary. Bulk writes to the
 * database are handled by the Green Dog data pipeline, so this surfaces the
 * parsed contents for verification rather than committing rows silently.
 */
export function previewCsvImport(file: File, entityLabel: string) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result ?? ""));
    const dataRows = Math.max(0, rows.length - 1);
    const headers = rows[0]?.slice(0, 12).join(", ") ?? "";
    window.alert(
      `Parsed “${file.name}”.\n\n` +
        `${dataRows} ${entityLabel} row${dataRows === 1 ? "" : "s"} detected.\n` +
        `Columns: ${headers}${rows[0] && rows[0].length > 12 ? "…" : ""}\n\n` +
        `Review the file, then import is processed through the Green Dog data pipeline.`,
    );
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Module header — title + import/export options (uniform across all views)
// ---------------------------------------------------------------------------
export function ModuleHeader({
  icon,
  eyebrow,
  title,
  description,
  count,
  countLabel = "records",
  onExport,
  onImport,
  importAccept = ".csv",
  addHref,
  addLabel = "Add New",
  actions,
}: {
  icon?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  count?: number;
  countLabel?: string;
  onExport?: () => void;
  onImport?: (file: File) => void;
  importAccept?: string;
  addHref?: string;
  addLabel?: string;
  actions?: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          {icon ? <span aria-hidden>{icon}</span> : null}
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">
            {description}
            {count !== undefined ? ` · ${count.toLocaleString()} ${countLabel}` : ""}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {addHref ? (
          <Link
            href={addHref}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            + {addLabel}
          </Link>
        ) : null}
        {onImport ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={importAccept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              ⬆ Import
            </button>
          </>
        ) : null}
        {onExport ? (
          <button
            onClick={onExport}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            ⬇ Export
          </button>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable data table — search + adaptive filters + click-to-sort columns
// ---------------------------------------------------------------------------
export type CellValue = string | number | boolean | null | undefined;

export interface Column<T> {
  key: string;
  header: string;
  /** Raw value used for sorting AND global search. */
  value: (row: T) => CellValue;
  /** Optional custom cell renderer (defaults to the stringified value). */
  render?: (row: T) => React.ReactNode;
  /** Defaults to true. Set false to disable header-click sorting. */
  sortable?: boolean;
  className?: string;
}

export interface FilterDef<T> {
  key: string;
  label: string;
  /** Returns the filter value for a row (null/empty => excluded from options). */
  value: (row: T) => string | null | undefined;
  /**
   * When true, `value` returns a comma-separated list of values. Each token
   * becomes its own filter option, and a row matches if it contains the
   * selected token (membership) rather than an exact string equality.
   */
  multi?: boolean;
}

/** Split a comma-separated filter value into trimmed, non-empty tokens. */
function splitFilterTokens(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type SortDir = "asc" | "desc";

export function SortIcon({ dir }: { dir: SortDir | null }) {
  return (
    <span className="ml-1 inline-flex w-3 flex-col text-[9px] leading-[7px]">
      <span className={dir === "asc" ? "text-emerald-600" : "text-slate-300"}>▲</span>
      <span className={dir === "desc" ? "text-emerald-600" : "text-slate-300"}>▼</span>
    </span>
  );
}

export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function compareValues(a: CellValue, b: CellValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empties always sort last
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchExtra,
  searchPlaceholder = "Search…",
  onRowClick,
  emptyLabel = "No records match your search.",
  initialActive,
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: FilterDef<T>[];
  /** Extra hidden text included in the global search (e.g. email, notes). */
  searchExtra?: (row: T) => CellValue[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
  /** Optional default-selected filter values, keyed by filter key. */
  initialActive?: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [active, setActive] = useState<Record<string, string>>(initialActive ?? {});

  // Build filter dropdowns: only keep filters that have 2+ distinct values.
  const filterOptions = useMemo(() => {
    return filters
      .map((f) => {
        const seen = new Map<string, number>();
        for (const r of rows) {
          const v = f.value(r);
          if (v === null || v === undefined || v === "") continue;
          const tokens = f.multi ? splitFilterTokens(v) : [v];
          for (const t of tokens) {
            seen.set(t, (seen.get(t) ?? 0) + 1);
          }
        }
        const options = [...seen.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
          .map(([value, count]) => ({ value, count }));
        return { def: f, options };
      })
      .filter((f) => f.options.length > 1);
  }, [filters, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of filters) {
        const sel = active[f.key];
        if (!sel || sel === "all") continue;
        const raw = f.value(r) ?? "";
        if (f.multi) {
          if (!splitFilterTokens(raw).includes(sel)) return false;
        } else if (raw !== sel) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        ...columns.map((c) => c.value(r)),
        ...(searchExtra ? searchExtra(r) : []),
      ]
        .map(cellText)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, columns, filters, active, query, searchExtra]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => compareValues(col.value(a), col.value(b)) * dir,
    );
  }, [filtered, columns, sortKey, sortDir]);

  function toggleSort(col: Column<T>) {
    if (col.sortable === false) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  const hasActiveFilters =
    Object.values(active).some((v) => v && v !== "all") || query.trim() !== "";

  return (
    <>
      {/* Toolbar: prominent search + adaptive filter dropdowns */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-64">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {filterOptions.map(({ def, options }) => (
          <div key={def.key} className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-slate-500">{def.label}</label>
            <select
              value={active[def.key] ?? "all"}
              onChange={(e) => setActive((s) => ({ ...s, [def.key]: e.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All ({rows.length})</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>
        ))}

        {hasActiveFilters && (
          <button
            onClick={() => {
              setQuery("");
              setActive({});
            }}
            className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Clear
          </button>
        )}

        <span className="text-xs text-slate-400 sm:ml-auto">
          {sorted.length} of {rows.length}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col)}
                    className={`px-4 py-3 ${
                      sortable ? "cursor-pointer select-none hover:text-slate-700" : ""
                    } ${col.className ?? ""}`}
                  >
                    <span className="inline-flex items-center">
                      {col.header}
                      {sortable && <SortIcon dir={isSorted ? sortDir : null} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={`transition hover:bg-emerald-50 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2.5 text-slate-700 ${col.className ?? ""}`}
                  >
                    {col.render ? col.render(row) : cellText(col.value(row)) || "—"}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
