"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SlotDay } from "@/lib/ats/scheduling";
import { PublicNotice } from "@/lib/ats/public-shell";
import { confirmInterview } from "./actions";

export function SlotPicker({ token, days, zone }: { token: string; days: SlotDay[]; zone: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ when: string; withName: string | null; title: string } | null>(null);
  const [pending, startTransition] = useTransition();

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
      <p className="text-sm font-medium text-slate-700">
        Choose a time <span className="font-normal text-slate-400">({zone})</span>
      </p>
      <div className="space-y-4">
        {days.map((d) => (
          <div key={d.date}>
            <p className="mb-2 text-sm font-semibold text-slate-900">{d.label}</p>
            <div className="flex flex-wrap gap-2">
              {d.times.map((t) => (
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
        ))}
      </div>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button
        type="button"
        disabled={!picked || pending}
        onClick={() => {
          if (!picked) return;
          startTransition(async () => {
            const res = await confirmInterview(token, picked);
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
        {pending ? "Booking…" : "Confirm Interview"}
      </button>
    </div>
  );
}
