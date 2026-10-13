"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PUNCH_LABELS, type PunchType } from "@/lib/timeclock/state";
import { recordPunch } from "./actions";

interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** The device location at this moment only, or null (denied, unavailable, slow). */
function currentPosition(): Promise<Position | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

const PRIMARY: Record<PunchType, string> = {
  clock_in: "bg-emerald-600 hover:bg-emerald-700 text-white",
  lunch_start: "bg-amber-500 hover:bg-amber-600 text-white",
  lunch_end: "bg-emerald-600 hover:bg-emerald-700 text-white",
  clock_out: "bg-slate-800 hover:bg-slate-900 text-white",
};

export function ClockPanel({
  allowed,
  nonExempt,
}: {
  allowed: readonly PunchType[];
  nonExempt: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<string | null>(null);
  const [askRest, setAskRest] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (type: PunchType, restBreaksOk: boolean | null) =>
    start(async () => {
      setResult(null);
      setStep("Checking your location…");
      const pos = await currentPosition();
      setStep("Saving…");
      const res = await recordPunch({
        type,
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
        accuracy: pos?.accuracy ?? null,
        clientTime: new Date().toISOString(),
        restBreaksOk,
      });
      setStep(null);
      setAskRest(false);
      setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      router.refresh();
    });

  const onPress = (type: PunchType) => {
    if (type === "clock_out" && nonExempt) {
      setResult(null);
      setAskRest(true);
      return;
    }
    submit(type, null);
  };

  return (
    <div className="space-y-3">
      {askRest ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">
            Were you able to take your rest breaks today?
          </p>
          <p className="mt-1 text-xs text-slate-500">
            A paid 10-minute break for every 4 hours worked (or major part of 4 hours).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              disabled={pending}
              onClick={() => submit("clock_out", true)}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Yes — clock out
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit("clock_out", false)}
              className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              No — clock out
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAskRest(false)}
              className="col-span-2 rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:flex">
          {allowed.map((type) => (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() => onPress(type)}
              className={`rounded-xl px-6 py-4 text-lg font-semibold shadow-sm transition disabled:opacity-60 ${PRIMARY[type]}`}
            >
              {PUNCH_LABELS[type]}
            </button>
          ))}
        </div>
      )}
      {step ? <p className="text-sm text-slate-500">{step}</p> : null}
      {result ? (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
