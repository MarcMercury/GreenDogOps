"use client";

import { useState, useTransition } from "react";
import { LOCATION_RESULT_LABELS } from "@/lib/timeclock/location-check";
import { testFromHere, type TestFromHereResult } from "./actions";

function position(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

const RESULT_STYLE: Record<string, string> = {
  on_site: "bg-emerald-50 text-emerald-800",
  other_clinic: "bg-sky-50 text-sky-800",
  off_site: "bg-amber-50 text-amber-800",
  not_checked: "bg-slate-100 text-slate-600",
};

export function TestFromHere({ clinics }: { clinics: { id: string; name: string }[] }) {
  const [busy, start] = useTransition();
  const [scheduled, setScheduled] = useState(clinics[0]?.id ?? "");
  const [res, setRes] = useState<TestFromHereResult | null>(null);

  const run = () =>
    start(async () => {
      setRes(null);
      const pos = await position();
      setRes(
        await testFromHere({
          latitude: pos?.latitude ?? null,
          longitude: pos?.longitude ?? null,
          accuracy: pos?.accuracy ?? null,
          scheduledLocationId: scheduled || null,
        }),
      );
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Pretend I&apos;m scheduled at</span>
          <select
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">Unscheduled</option>
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Test from here"}
        </button>
        <p className="text-xs text-slate-400">Uses this device&apos;s network and location. Nothing is recorded.</p>
      </div>

      {res && !res.ok ? <p className="text-sm text-red-600">{res.error}</p> : null}
      {res && res.ok ? (
        <div className="space-y-3">
          <div className={`rounded-xl px-4 py-3 text-sm ${RESULT_STYLE[res.overall.result]}`}>
            <p className="font-semibold">A punch from here would be: {LOCATION_RESULT_LABELS[res.overall.result]}</p>
            <p className="text-xs">{res.overall.reason}</p>
          </div>
          <p className="text-xs text-slate-500">
            Your public IP: <code>{res.ip ?? "unknown"}</code>
            {res.ip && !res.ipIsPublic ? " (internal — this happens in local development, not on the live site)" : ""} · GPS:{" "}
            {res.gps
              ? `${res.gps.latitude.toFixed(5)}, ${res.gps.longitude.toFixed(5)} (±${Math.round(res.gps.accuracy ?? 0)} m)`
              : "not available (permission denied or no GPS)"}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Clinic</th>
                  <th className="py-1 pr-3 font-medium">Network</th>
                  <th className="py-1 pr-3 font-medium">Distance</th>
                  <th className="py-1 pr-3 font-medium">GPS accuracy</th>
                  <th className="py-1 font-medium">Passes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {res.clinics.map((c) => (
                  <tr key={c.locationId}>
                    <td className="py-1.5 pr-3">{c.name}</td>
                    <td className="py-1.5 pr-3">
                      {c.policy === "anywhere_logged" ? "—" : c.networkMatchId ? "✓ matched" : "no match"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {c.distanceM === null ? "—" : `${Math.round(c.distanceM)} m${c.insideFence ? " (inside)" : ""}`}
                    </td>
                    <td className="py-1.5 pr-3">{c.accuracyOk === null ? "—" : c.accuracyOk ? "ok" : "too imprecise"}</td>
                    <td className="py-1.5">{!c.configured ? "not set up" : c.passes ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
