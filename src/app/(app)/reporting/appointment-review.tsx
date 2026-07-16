"use client";

import { Fragment, useState, useTransition } from "react";
import type { AppointmentReviewRow } from "@/lib/reporting/types";
import { getAppointmentReview } from "./actions";
import { StatCard, SectionCard, fmtNumber, fmtDate } from "./charts";
import { useTableSort, SortHeader, stickyHeadClass } from "../_components/data-views";

/** Local date (browser tz) N days ago as ISO YYYY-MM-DD. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

interface DeptAgg {
  department_id: string;
  department_name: string;
  department_color: string | null;
  booked: number;
  rendered: number;
  dropped: number;
  pending: number;
  days: {
    appt_date: string;
    booked: number;
    rendered: number | null;
    dropped: number | null;
  }[];
}

interface LocationAgg {
  location_id: string;
  location_name: string;
  booked: number;
  rendered: number;
  dropped: number;
  pending: number;
  depts: DeptAgg[];
}

/** Roll the flat review rows up into location → department → day. */
function aggregate(rows: AppointmentReviewRow[]): LocationAgg[] {
  const locs = new Map<string, LocationAgg>();
  for (const r of rows) {
    let loc = locs.get(r.location_id);
    if (!loc) {
      loc = {
        location_id: r.location_id,
        location_name: r.location_name,
        booked: 0,
        rendered: 0,
        dropped: 0,
        pending: 0,
        depts: [],
      };
      locs.set(r.location_id, loc);
    }
    let dept = loc.depts.find((d) => d.department_id === r.department_id);
    if (!dept) {
      dept = {
        department_id: r.department_id,
        department_name: r.department_name,
        department_color: r.department_color,
        booked: 0,
        rendered: 0,
        dropped: 0,
        pending: 0,
        days: [],
      };
      loc.depts.push(dept);
    }
    const booked = r.expected_count ?? 0;
    const rendered = r.rendered_count;
    const dropped = rendered == null ? null : Math.max(booked - rendered, 0);

    dept.booked += booked;
    loc.booked += booked;
    if (rendered == null) {
      dept.pending += 1;
      loc.pending += 1;
    } else {
      dept.rendered += rendered;
      dept.dropped += dropped ?? 0;
      loc.rendered += rendered;
      loc.dropped += dropped ?? 0;
    }
    dept.days.push({ appt_date: r.appt_date, booked, rendered, dropped });
  }

  const list = [...locs.values()];
  for (const loc of list) {
    loc.depts.sort((a, b) => b.dropped - a.dropped || b.booked - a.booked);
    for (const dept of loc.depts) {
      dept.days.sort((a, b) => b.appt_date.localeCompare(a.appt_date));
    }
  }
  list.sort((a, b) => a.location_name.localeCompare(b.location_name));
  return list;
}

function dropPct(booked: number, dropped: number): string {
  if (!booked) return "0%";
  return `${Math.round((dropped / booked) * 100)}%`;
}

export function AppointmentReview() {
  const [start, setStart] = useState(() => isoDaysAgo(7));
  const [end, setEnd] = useState(() => isoDaysAgo(1));
  const [rows, setRows] = useState<AppointmentReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await getAppointmentReview(start, end);
      if (res.ok) {
        setRows(res.rows);
      } else {
        setRows(null);
        setError(res.error);
      }
    });
  }

  const locations = rows ? aggregate(rows) : [];
  const totals = locations.reduce(
    (acc, l) => {
      acc.booked += l.booked;
      acc.rendered += l.rendered;
      acc.dropped += l.dropped;
      acc.pending += l.pending;
      return acc;
    },
    { booked: 0, rendered: 0, dropped: 0, pending: 0 },
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Appointment Review"
        description="Compares what was booked on a past day against what actually rendered, by location and department. The gap is appointments that cancelled or moved. Requires the daily Agenda pulls to have captured that day both before and after it passed."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              value={end}
              max={isoDaysAgo(0)}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Loading…" : "Run review"}
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        ) : null}
      </SectionCard>

      {rows == null ? (
        <p className="text-sm text-slate-400">
          Choose a date range and run the review.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          No Agenda snapshots cover this range yet. The daily agent needs to have
          captured these days both before and after they occurred.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Booked" value={fmtNumber(totals.booked)} accent="indigo" />
            <StatCard label="Rendered" value={fmtNumber(totals.rendered)} accent="emerald" />
            <StatCard
              label="Cancelled / Moved"
              value={fmtNumber(totals.dropped)}
              accent="amber"
              sub={totals.pending ? `${totals.pending} cell(s) pending re-scan` : undefined}
            />
            <StatCard
              label="Drop rate"
              value={dropPct(totals.rendered + totals.dropped, totals.dropped)}
              accent="slate"
              sub="of resolved appointments"
            />
          </div>

          {locations.map((loc) => (
            <SectionCard
              key={loc.location_id}
              title={loc.location_name}
              description={`${fmtNumber(loc.booked)} booked → ${fmtNumber(
                loc.rendered,
              )} rendered · ${fmtNumber(loc.dropped)} cancelled/moved`}
            >
              <LocationTable loc={loc} />
            </SectionCard>
          ))}
        </>
      )}
    </div>
  );
}

/** Per-location department table with expandable per-day detail. */
function LocationTable({ loc }: { loc: LocationAgg }) {
  const [open, setOpen] = useState<string | null>(null);

  const sort = useTableSort(loc.depts, {
    department: (d) => d.department_name,
    booked: (d) => d.booked,
    rendered: (d) => d.rendered,
    dropped: (d) => d.dropped,
    dropPct: (d) => {
      const resolved = d.rendered + d.dropped;
      return resolved > 0 ? d.dropped / resolved : 0;
    },
  });

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead className={stickyHeadClass}>
          <tr className="border-b border-slate-200 text-left">
            <SortHeader label="Department" sortKey="department" sort={sort} className="py-2 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400" />
            <SortHeader label="Booked" sortKey="booked" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
            <SortHeader label="Rendered" sortKey="rendered" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
            <SortHeader label="Cancelled/Moved" sortKey="dropped" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
            <SortHeader label="Drop %" sortKey="dropPct" sort={sort} align="right" className="px-2 py-2 text-xs font-semibold text-slate-500" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((d) => {
            const isOpen = open === d.department_id;
            const resolved = d.rendered + d.dropped;
            return (
              <Fragment key={d.department_id}>
                <tr
                  className={`border-b border-slate-100 last:border-0 ${
                    isOpen ? "bg-emerald-50/40" : ""
                  }`}
                >
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : d.department_id)}
                      className="flex items-center gap-2 text-left font-medium text-slate-700 transition hover:text-slate-900"
                      aria-expanded={isOpen}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: d.department_color || "#64748b" }}
                      />
                      {d.department_name}
                      <span className="text-[10px] text-slate-400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      {d.pending ? (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {d.pending} pending
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(d.booked)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {fmtNumber(d.rendered)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-amber-700">
                    {fmtNumber(d.dropped)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                    {dropPct(resolved, d.dropped)}
                  </td>
                </tr>
                {isOpen ? (
                  <tr key={`${d.department_id}-days`}>
                    <td colSpan={5} className="bg-slate-50/70 px-3 py-3">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-left text-slate-400">
                            <th className="py-1 pr-3 font-medium">Date</th>
                            <th className="px-2 py-1 text-right font-medium">Booked</th>
                            <th className="px-2 py-1 text-right font-medium">Rendered</th>
                            <th className="px-2 py-1 text-right font-medium">
                              Cancelled/Moved
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.days.map((day) => (
                            <tr key={day.appt_date} className="border-t border-slate-100">
                              <td className="py-1 pr-3 text-slate-600">
                                {fmtDate(day.appt_date)}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                                {fmtNumber(day.booked)}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                                {day.rendered == null ? "—" : fmtNumber(day.rendered)}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-amber-700">
                                {day.dropped == null ? "pending" : fmtNumber(day.dropped)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
