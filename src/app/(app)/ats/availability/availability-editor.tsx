"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyWindow } from "@/lib/ats/scheduling";
import { disconnectGoogleCalendar, saveAvailability } from "../scheduling-actions";

const inputCls =
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const DAYS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];
const ZONES = ["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York"];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export function AvailabilityEditor({
  schedule,
  googleConfigured,
  redirectUri,
}: {
  schedule: {
    timezone: string;
    windows: WeeklyWindow[];
    default_duration: number;
    buffer_minutes: number;
    min_notice_hours: number;
    is_active: boolean;
    google_email: string | null;
    google_connected: boolean;
  };
  googleConfigured: boolean;
  redirectUri: string;
}) {
  const router = useRouter();
  const [windows, setWindows] = useState<WeeklyWindow[]>(schedule.windows);
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [duration, setDuration] = useState(schedule.default_duration);
  const [buffer, setBuffer] = useState(schedule.buffer_minutes);
  const [notice, setNotice] = useState(schedule.min_notice_hours);
  const [active, setActive] = useState(schedule.is_active);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const forDay = (day: number) => windows.map((w, i) => ({ w, i })).filter(({ w }) => w.day === day);
  const patch = (i: number, p: Partial<WeeklyWindow>) =>
    setWindows((prev) => prev.map((w, j) => (j === i ? { ...w, ...p } : w)));
  const add = (day: number) =>
    setWindows((prev) => {
      const last = prev.filter((w) => w.day === day).at(-1);
      return [...prev, last ? { day, start: last.end, end: last.end < "17:00" ? "17:00" : "18:00" } : { day, start: "10:00", end: "16:00" }];
    });
  const remove = (i: number) => setWindows((prev) => prev.filter((_, j) => j !== i));
  const copyToWeekdays = (day: number) =>
    setWindows((prev) => {
      const src = prev.filter((w) => w.day === day);
      const keep = prev.filter((w) => w.day === day || w.day === 0 || w.day === 6);
      return [...keep, ...[1, 2, 3, 4, 5].filter((d) => d !== day).flatMap((d) => src.map((w) => ({ ...w, day: d })))];
    });

  const save = () =>
    startTransition(async () => {
      const res = await saveAvailability({
        timezone,
        weekly_hours: windows,
        default_duration: duration,
        buffer_minutes: buffer,
        min_notice_hours: notice,
        is_active: active,
      });
      setResult(res.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <>
      <Card title="Google Calendar">
        {schedule.google_connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              ✅ Connected{schedule.google_email ? ` as ${schedule.google_email}` : ""}. Busy times are blocked and
              booked interviews are added to your calendar, with the candidate invited.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (!confirm("Disconnect Google Calendar? Candidates will only be blocked from times already booked in Ops.")) return;
                  await disconnectGoogleCalendar();
                  router.refresh();
                })
              }
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              Not connected. Without it, candidates can book over meetings on your calendar, and you&apos;ll get
              bookings by email with a calendar file instead.
            </p>
            {googleConfigured ? (
              <a
                href="/api/ats/google/connect"
                className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Connect Google Calendar
              </a>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Google sign-in isn&apos;t configured yet. An admin needs a Google OAuth web client with this redirect
                URI: <code className="break-all">{redirectUri}</code>
              </p>
            )}
          </div>
        )}
      </Card>

      <Card title="Weekly hours">
        <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded text-emerald-600" />
          Accept interview bookings
        </label>
        <div className="divide-y divide-slate-100">
          {DAYS.map(({ day, label }) => {
            const rows = forDay(day);
            return (
              <div key={day} className="flex flex-wrap items-start gap-3 py-2.5">
                <span className="w-24 pt-1.5 text-sm font-medium text-slate-700">{label}</span>
                <div className="flex-1 space-y-1.5">
                  {rows.length === 0 && <p className="pt-1.5 text-sm text-slate-400">Unavailable</p>}
                  {rows.map(({ w, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={w.start} step={900} onChange={(e) => patch(i, { start: e.target.value })} className={inputCls} />
                      <span className="text-slate-400">–</span>
                      <input type="time" value={w.end} step={900} onChange={(e) => patch(i, { end: e.target.value })} className={inputCls} />
                      <button type="button" onClick={() => remove(i)} aria-label="Remove" className="px-1 text-slate-400 hover:text-red-600">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1.5 text-xs font-medium">
                  <button type="button" onClick={() => add(day)} className="text-emerald-700 hover:text-emerald-900">
                    + Add
                  </button>
                  {rows.length > 0 && day >= 1 && day <= 5 && (
                    <button type="button" onClick={() => copyToWeekdays(day)} className="text-slate-500 hover:text-slate-800">
                      Copy to Mon–Fri
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Booking rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-medium text-slate-500">Time zone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${inputCls} w-full`}>
              {[...new Set([timezone, ...ZONES])].map((z) => (
                <option key={z} value={z}>
                  {z.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-medium text-slate-500">Default interview length (minutes)</span>
            <input type="number" min={10} max={240} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`${inputCls} w-full`} />
          </label>
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-medium text-slate-500">Buffer between interviews (minutes)</span>
            <input type="number" min={0} max={120} step={5} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} className={`${inputCls} w-full`} />
          </label>
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-medium text-slate-500">Minimum notice (hours)</span>
            <input type="number" min={0} max={336} value={notice} onChange={(e) => setNotice(Number(e.target.value))} className={`${inputCls} w-full`} />
          </label>
        </div>
      </Card>

      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        {result && <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-600"}`}>{result.text}</span>}
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save availability"}
        </button>
      </div>
    </>
  );
}
