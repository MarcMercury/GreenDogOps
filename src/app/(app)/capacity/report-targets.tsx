"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveReportCapacityTarget,
  saveReportCapacityOverride,
  deleteReportCapacityOverride,
} from "./actions";

export const REPORT_TRACKS = [
  { key: "dental", label: "Dental" },
  { key: "ve", label: "VE" },
  { key: "ap", label: "AP" },
] as const;

export type ReportTrack = (typeof REPORT_TRACKS)[number]["key"];

export interface ReportCapacityTarget {
  id: string;
  location_id: string;
  track: ReportTrack;
  weekday: number;
  capacity: number;
}

export interface ReportCapacityOverride {
  id: string;
  location_id: string;
  track: ReportTrack;
  appt_date: string;
  capacity: number;
  note: string | null;
}

interface LocLite {
  id: string;
  name: string | null;
  short_code: string | null;
}

/** Monday first — the report never shows a clinic that offers nothing. */
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const inputClass =
  "w-14 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-50";

/**
 * Slot counts behind the twice-weekly "upcoming appointments" Slack post. The
 * grid is the recurring weekly pattern; the list below it holds one-off dates
 * (closures, student days, an extra doctor) that win over the pattern.
 *
 * These are deliberately separate from the staffing-driven capacity rules
 * above: the Slack report splits the dental and vet-exam lanes, which the
 * area-level rules cannot express.
 */
export function ReportCapacityManager({
  locations,
  targets,
  overrides,
  canEdit,
}: {
  locations: LocLite[];
  targets: ReportCapacityTarget[];
  overrides: ReportCapacityOverride[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    location_id: locations[0]?.id ?? "",
    track: "dental" as ReportTrack,
    appt_date: "",
    capacity: "0",
    note: "",
  });

  const targetFor = (locationId: string, track: ReportTrack, weekday: number) =>
    targets.find(
      (t) => t.location_id === locationId && t.track === track && t.weekday === weekday,
    )?.capacity ?? 0;

  const locName = (id: string) => {
    const l = locations.find((x) => x.id === id);
    return l?.name ?? l?.short_code ?? "Location";
  };

  const saveTarget = (
    locationId: string,
    track: ReportTrack,
    weekday: number,
    value: string,
  ) => {
    const next = value.trim() === "" ? 0 : Number(value);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === targetFor(locationId, track, weekday)) return;
    setError(null);
    const fd = new FormData();
    fd.set("location_id", locationId);
    fd.set("track", track);
    fd.set("weekday", String(weekday));
    fd.set("capacity", String(Math.round(next)));
    start(async () => {
      const res = await saveReportCapacityTarget(fd);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const addOverride = () => {
    if (!draft.location_id || !draft.appt_date) {
      setError("Pick a location and a date for the override.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("location_id", draft.location_id);
    fd.set("track", draft.track);
    fd.set("appt_date", draft.appt_date);
    fd.set("capacity", draft.capacity || "0");
    if (draft.note.trim()) fd.set("note", draft.note.trim());
    start(async () => {
      const res = await saveReportCapacityOverride(fd);
      if (res.ok) {
        setDraft((d) => ({ ...d, appt_date: "", capacity: "0", note: "" }));
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const removeOverride = (id: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    start(async () => {
      const res = await deleteReportCapacityOverride(fd);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const upcoming = [...overrides].sort((a, b) =>
    a.appt_date === b.appt_date
      ? locName(a.location_id).localeCompare(locName(b.location_id))
      : a.appt_date.localeCompare(b.appt_date),
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-bold text-slate-800">
          Slack report — appointment slots offered
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          How many Dental, VE and AP appointments each clinic offers on a normal
          week. These are the denominators in the upcoming-appointments post that
          goes out Tuesdays and Thursdays. 0 means the lane is closed.
        </p>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-5">
        {locations.map((loc) => (
          <div key={loc.id}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              {loc.name ?? loc.short_code}
            </h3>
            <table className="mt-1.5 text-sm">
              <thead>
                <tr>
                  <th className="w-20 pr-2 text-left text-xs font-medium text-slate-500" />
                  {WEEKDAYS.map((d) => (
                    <th
                      key={d.value}
                      className="px-1 pb-1 text-center text-xs font-medium text-slate-500"
                    >
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REPORT_TRACKS.map((track) => (
                  <tr key={track.key}>
                    <th className="pr-2 text-left text-xs font-medium text-slate-600">
                      {track.label}
                    </th>
                    {WEEKDAYS.map((d) => (
                      <td key={d.value} className="px-1 py-0.5">
                        <input
                          type="number"
                          min={0}
                          max={200}
                          disabled={!canEdit || pending}
                          defaultValue={targetFor(loc.id, track.key, d.value)}
                          onBlur={(e) =>
                            saveTarget(loc.id, track.key, d.value, e.target.value)
                          }
                          className={inputClass}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          One-off dates
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Overrides the weekly pattern for a single date. The note shows under
          the table in Slack — e.g. &ldquo;Western students&rdquo;.
        </p>

        <div className="mt-2 space-y-1.5">
          {upcoming.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
              No upcoming overrides.
            </p>
          ) : (
            upcoming.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
              >
                <span className="text-xs font-semibold text-slate-700">
                  {o.appt_date}
                </span>
                <span className="text-xs text-slate-600">
                  {locName(o.location_id)} ·{" "}
                  {REPORT_TRACKS.find((t) => t.key === o.track)?.label ?? o.track}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold tabular-nums text-white ${
                    o.capacity === 0 ? "bg-slate-500" : "bg-emerald-600"
                  }`}
                >
                  {o.capacity === 0 ? "Closed" : `${o.capacity} appt`}
                </span>
                {o.note ? (
                  <span className="text-[11px] italic text-slate-400">{o.note}</span>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeOverride(o.id)}
                    className="ml-auto text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Location
              <select
                value={draft.location_id}
                onChange={(e) => setDraft((d) => ({ ...d, location_id: e.target.value }))}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name ?? l.short_code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Track
              <select
                value={draft.track}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, track: e.target.value as ReportTrack }))
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                {REPORT_TRACKS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Date
              <input
                type="date"
                value={draft.appt_date}
                onChange={(e) => setDraft((d) => ({ ...d, appt_date: e.target.value }))}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Slots
              <input
                type="number"
                min={0}
                max={200}
                value={draft.capacity}
                onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
              Note
              <input
                type="text"
                value={draft.note}
                placeholder="Western students"
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={addOverride}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Save override
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
