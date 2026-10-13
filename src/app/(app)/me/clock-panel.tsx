"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PUNCH_LABELS, type PunchType } from "@/lib/timeclock/state";
import { recordPunch, type PunchInput } from "./actions";

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

type Pending = Pick<PunchInput, "type" | "restBreaksOk" | "abandonPrevious">;

export function ClockPanel({
  allowed,
  nonExempt,
  offerNewShift,
}: {
  allowed: readonly PunchType[];
  nonExempt: boolean;
  /** Still clocked in from > 8 h ago: offer "I forgot to clock out — start a new shift". */
  offerNewShift: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [step, setStep] = useState<string | null>(null);
  const [askRest, setAskRest] = useState(false);
  const [offsite, setOffsite] = useState<{ pending: Pending; reason: string } | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (pending: Pending, offsiteNote: string | null = null) =>
    start(async () => {
      setResult(null);
      setStep("Checking your location…");
      const pos = await currentPosition();
      setStep("Saving…");
      const res = await recordPunch({
        ...pending,
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
        accuracy: pos?.accuracy ?? null,
        clientTime: new Date().toISOString(),
        offsiteNote,
      });
      setStep(null);
      setAskRest(false);
      if (!res.ok && res.offsite) {
        setOffsite({ pending, reason: res.offsite.reason });
        return;
      }
      setOffsite(null);
      setNote("");
      setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      router.refresh();
    });

  const onPress = (type: PunchType, abandonPrevious = false) => {
    setResult(null);
    if (type === "clock_out" && nonExempt) {
      setAskRest(true);
      return;
    }
    submit({ type, abandonPrevious });
  };

  if (offsite) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">You don&apos;t appear to be at a Green Dog clinic.</p>
        <p className="text-xs text-amber-800">{offsite.reason}</p>
        <label className="block text-sm">
          <span className="text-slate-700">If you&apos;re working off-site, say why (a manager will approve it):</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            placeholder="e.g. Picking up supplies for Venice; home visit with Dr. Lee"
          />
        </label>
        <div className="grid gap-2 sm:flex">
          <button
            type="button"
            disabled={busy || note.trim().length === 0}
            onClick={() => submit(offsite.pending, note.trim())}
            className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            Working off-site — {PUNCH_LABELS[offsite.pending.type].toLowerCase()}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(offsite.pending)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Try again
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOffsite(null);
              setNote("");
            }}
            className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
          >
            Cancel
          </button>
        </div>
        {step ? <p className="text-sm text-slate-500">{step}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {askRest ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">Were you able to take your rest breaks today?</p>
          <p className="mt-1 text-xs text-slate-500">
            A paid 10-minute break for every 4 hours worked (or major part of 4 hours).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ type: "clock_out", restBreaksOk: true })}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Yes — clock out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ type: "clock_out", restBreaksOk: false })}
              className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              No — clock out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAskRest(false)}
              className="col-span-2 rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:flex">
            {allowed.map((type) => (
              <button
                key={type}
                type="button"
                disabled={busy}
                onClick={() => onPress(type)}
                className={`rounded-xl px-6 py-4 text-lg font-semibold shadow-sm transition disabled:opacity-60 ${PRIMARY[type]}`}
              >
                {PUNCH_LABELS[type]}
              </button>
            ))}
          </div>
          {offerNewShift ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPress("clock_in", true)}
              className="w-full rounded-xl border border-emerald-600 px-6 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 sm:w-auto"
            >
              I forgot to clock out — start a new shift
            </button>
          ) : null}
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
