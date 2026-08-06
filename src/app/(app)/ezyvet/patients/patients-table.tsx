"use client";

import { fmtDate } from "../../reporting/charts";
import { useTableSort, SortHeader, stickyHeadClass } from "../../_components/data-views";
import { PATIENT_COLUMNS, type PatientRow } from "./columns";

function renderCell(value: unknown, type: string) {
  if (value == null || value === "") return <span className="text-slate-300">—</span>;
  if (type === "bool") return value ? "Yes" : "No";
  if (type === "date") return fmtDate(String(value));
  if (type === "number") return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;
  return String(value);
}

export function PatientsTable({ patients }: { patients: PatientRow[] }) {
  const accessors = Object.fromEntries(
    PATIENT_COLUMNS.map((c) => [
      c.key,
      (row: PatientRow) => {
        const v = row[c.key];
        return typeof v === "boolean" ? (v ? 1 : 0) : v;
      },
    ]),
  );
  const sort = useTableSort(patients, accessors);

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-max min-w-full text-left text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
            {PATIENT_COLUMNS.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                sortKey={c.key}
                sort={sort}
                align={c.type === "number" ? "right" : "left"}
                className="whitespace-nowrap px-2 py-2 font-semibold"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((p) => (
            <tr key={p.id} className="border-b border-slate-50 align-top hover:bg-slate-50/60">
              {PATIENT_COLUMNS.map((c) => (
                <td
                  key={c.key}
                  title={c.type === "long" ? String(p[c.key] ?? "") : undefined}
                  className={`px-2 py-2 text-xs text-slate-600 ${
                    c.type === "long"
                      ? "max-w-[280px] truncate"
                      : c.type === "number"
                        ? "text-right"
                        : "whitespace-nowrap"
                  }`}
                >
                  {renderCell(p[c.key], c.type)}
                </td>
              ))}
            </tr>
          ))}
          {patients.length === 0 ? (
            <tr>
              <td colSpan={PATIENT_COLUMNS.length} className="py-6 text-center text-sm text-slate-400">
                No patients match your search.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
