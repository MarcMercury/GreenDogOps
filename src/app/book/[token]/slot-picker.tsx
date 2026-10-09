"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { monthGrid, monthLabel, monthOf, shiftMonth, type SlotDay } from "@/lib/ats/scheduling";
import { PublicNotice } from "@/lib/ats/public-shell";
import { confirmInterview } from "./actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Calendly-style picker: a month calendar with the interviewer's open days,
 * the open times for the chosen day beside it, then Confirm.
 */
export function SlotPicker({
  token,
  days,
  zone,
  withName,
  durationMinutes,
}: {
  token: string;
  days: SlotDay[];
  zone: string;
  withName: string | null;
  durationMinutes: number;
}) {
  const router = useRouter();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const firstMonth = monthOf(days[0].date);
  const lastMonth = monthOf(days[days.length - 1].date);

  const [selectedDate, setSelectedDate] = useState(days[0].date);
  const [month, setMonth] = useState(firstMonth);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ when: string; withName: string | null; title: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // After a refresh (time taken) the chosen day or month may have no times left.
  const day = byDate.get(selectedDate) ?? days[0];
  const shownMonth = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
  const pickedTime = picked ? day.times.find((t) => t.iso === picked) : undefined;

  if (booked) {
    return (
      <PublicNotice
        icon="🎉"
        title="You're booked!"
        body={`${booked.title} · ${booked.when}${booked.withName ? `\nWith ${booked.withName}` : ""}\n\nA confirmation and calendar invite are on the way to your email.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        {withName && <span className="font-medium text-slate-800">With {withName} · </span>}
        {durationMinutes} min · times shown in {zone}
      </p>

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              disabled={shownMonth <= firstMonth}
              onClick={() => setMonth(shiftMonth(shownMonth, -1))}
              className="rounded-full px-3 py-1 text-lg text-emerald-700 hover:bg-emerald-50 disabled:invisible"
            >
              ‹
            </button>
            <p className="text-sm font-semibold text-slate-900">{monthLabel(shownMonth)}</p>
            <button
              type="button"
              aria-label="Next month"
              disabled={shownMonth >= lastMonth}
              onClick={() => setMonth(shiftMonth(shownMonth, 1))}
              className="rounded-full px-3 py-1 text-lg text-emerald-700 hover:bg-emerald-50 disabled:invisible"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthGrid(shownMonth)
              .flat()
              .map((date, i) => {
                if (!date) return <div key={`blank-${i}`} />;
                const open = byDate.has(date);
                const selected = date === day.date;
                return (
                  <div key={date} className="flex justify-center">
                    <button
                      type="button"
                      disabled={!open}
                      aria-pressed={selected}
                      aria-label={open ? byDate.get(date)!.label : undefined}
                      onClick={() => {
                        setSelectedDate(date);
                        setPicked(null);
                        setError(null);
                      }}
                      className={`h-10 w-10 rounded-full text-sm transition ${
                        selected
                          ? "bg-emerald-700 font-semibold text-white"
                          : open
                            ? "bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-100"
                            : "cursor-default text-slate-300"
                      }`}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900">{day.label}</p>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
            {day.times.map((t) => (
              <button
                key={t.iso}
                type="button"
                onClick={() => {
                  setPicked(t.iso);
                  setError(null);
                }}
                aria-pressed={picked === t.iso}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  picked === t.iso
                    ? "border-emerald-700 bg-emerald-700 text-white"
                    : "border-emerald-200 bg-white text-emerald-800 hover:border-emerald-500"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="border-t border-slate-100 pt-4">
        {pickedTime && (
          <p className="mb-3 text-center text-sm text-slate-700">
            <span className="font-semibold text-slate-900">{day.label}</span> · {pickedTime.label} {zone}
          </p>
        )}
        <button
          type="button"
          disabled={!pickedTime || pending}
          onClick={() => {
            if (!pickedTime) return;
            startTransition(async () => {
              const res = await confirmInterview(token, pickedTime.iso);
              if (res.ok) {
                setBooked(res);
                return;
              }
              setError(res.error);
              if (res.taken) {
                setPicked(null);
                router.refresh();
              }
            });
          }}
          className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Booking…" : pickedTime ? "Confirm Interview" : "Pick a day and time"}
        </button>
      </div>
    </div>
  );
}
