"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACCURACY_RANGE, POLICY_LABELS, RADIUS_RANGE } from "@/lib/timeclock/clinic-settings";
import { CLOCK_POLICIES } from "@/lib/timeclock/location-check";
import type { AdminClinic } from "@/lib/timeclock/admin";
import {
  addClinicNetwork,
  captureCurrentNetwork,
  geocodeClinic,
  saveClinicClockSettings,
  setNetworkActive,
} from "./actions";
import { GeofenceMap } from "./geofence-map";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50";

const LEVEL_STYLE = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  off: "bg-red-50 text-red-700 ring-red-200",
} as const;

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Msg = { ok: boolean; text: string } | null;
function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>;
}

export function ClinicCard({ clinic, canEdit, mapsKey }: { clinic: AdminClinic; canEdit: boolean; mapsKey: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [lat, setLat] = useState(clinic.latitude?.toString() ?? "");
  const [lng, setLng] = useState(clinic.longitude?.toString() ?? "");
  const [radius, setRadius] = useState(String(clinic.geofence_radius_m));
  const [accuracy, setAccuracy] = useState(String(clinic.gps_max_accuracy_m));
  const [policy, setPolicy] = useState<string>(clinic.clock_policy);
  const [settingsMsg, setSettingsMsg] = useState<Msg>(null);
  const [netMsg, setNetMsg] = useState<Msg>(null);
  const [captureLabel, setCaptureLabel] = useState("");

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const hasPin = lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(latNum) && Number.isFinite(lngNum);
  const dirty =
    lat !== (clinic.latitude?.toString() ?? "") ||
    lng !== (clinic.longitude?.toString() ?? "") ||
    radius !== String(clinic.geofence_radius_m) ||
    accuracy !== String(clinic.gps_max_accuracy_m) ||
    policy !== clinic.clock_policy;

  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("location_id", clinic.id);
      fd.set("latitude", lat);
      fd.set("longitude", lng);
      fd.set("radius", radius);
      fd.set("accuracy", accuracy);
      fd.set("policy", policy);
      const res = await saveClinicClockSettings(fd);
      setSettingsMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  const geocode = () =>
    start(async () => {
      const res = await geocodeClinic(clinic.id);
      if (res.ok) {
        setLat(String(res.latitude));
        setLng(String(res.longitude));
        setSettingsMsg({ ok: true, text: res.message });
        router.refresh();
      } else setSettingsMsg({ ok: false, text: res.error });
    });

  const capture = () =>
    start(async () => {
      const res = await captureCurrentNetwork(clinic.id, captureLabel);
      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) {
        setCaptureLabel("");
        router.refresh();
      }
    });

  const toggle = (id: string, active: boolean) =>
    start(async () => {
      const res = await setNetworkActive(id, active);
      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  const mobile = policy === "anywhere_logged";
  const active = clinic.networks.filter((n) => n.is_active);
  const inactive = clinic.networks.filter((n) => !n.is_active);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{clinic.name}</h2>
          <p className="text-xs text-slate-500">{clinic.address || "No address on file"}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${LEVEL_STYLE[clinic.health.level]}`}>
          {clinic.health.status}
        </span>
      </header>

      <div className="space-y-5 p-5">
        {clinic.health.warnings.length > 0 ? (
          <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {clinic.health.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-slate-500">
          Last 7 days: {clinic.stats.punches7d} punch{clinic.stats.punches7d === 1 ? "" : "es"} here ·{" "}
          {clinic.stats.offsite7d} off-site · {clinic.stats.unchecked7d} not checked · {clinic.stats.punches24h} in the last 24 h
        </p>

        {/* Policy + geofence */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Clock policy</span>
              <select value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={!canEdit} className={inputCls}>
                {CLOCK_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {POLICY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            {!mobile ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Latitude</span>
                    <input value={lat} onChange={(e) => setLat(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="decimal" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Longitude</span>
                    <input value={lng} onChange={(e) => setLng(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="decimal" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Geofence radius (m, {RADIUS_RANGE.min}–{RADIUS_RANGE.max})
                    </span>
                    <input value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="numeric" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Required GPS accuracy (±m, {ACCURACY_RANGE.min}–{ACCURACY_RANGE.max})
                    </span>
                    <input value={accuracy} onChange={(e) => setAccuracy(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="numeric" />
                  </label>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={geocode}
                    disabled={busy || !clinic.address}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Use clinic address
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Punches here are always accepted; the device&apos;s GPS is recorded when available.
              </p>
            )}
            {canEdit ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !dirty}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Save settings
                </button>
                <Note msg={settingsMsg} />
              </div>
            ) : null}
          </div>
          <div>
            {!mobile && hasPin ? (
              <GeofenceMap
                apiKey={mapsKey}
                latitude={latNum}
                longitude={lngNum}
                radius={Number(radius) || clinic.geofence_radius_m}
                editable={canEdit}
                onMove={(a, b) => {
                  setLat(a.toFixed(6));
                  setLng(b.toFixed(6));
                }}
              />
            ) : !mobile ? (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                No geofence yet. {canEdit ? "Click “Use clinic address”, then drag the pin onto the building." : ""}
              </p>
            ) : null}
            {!mobile && hasPin && canEdit ? (
              <p className="mt-1 text-xs text-slate-400">Drag the pin to adjust, then save.</p>
            ) : null}
          </div>
        </div>

        {/* Approved networks */}
        {!mobile && policy !== "geofence_only" ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved networks</h3>
              <p className="text-xs text-slate-400">
                The clinic&apos;s public static IP (or block). Staff on these networks pass the check on any device.
              </p>
            </div>
            {active.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No approved network — geofence only until the static IP is entered.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {active.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-slate-800">{n.label}</span>{" "}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{n.cidr}</code>
                      <span className="ml-2 text-xs text-slate-400">
                        {n.added_via === "captured" ? "captured on site" : "entered"}
                        {n.added_by_name ? ` by ${n.added_by_name}` : ""} · last matched {when(n.last_matched_at)} · {n.match_count} match
                        {n.match_count === 1 ? "" : "es"}
                      </span>
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(n.id, false)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <form
                  className="space-y-2 rounded-xl border border-slate-200 p-3"
                  action={(fd) =>
                    start(async () => {
                      fd.set("location_id", clinic.id);
                      const res = await addClinicNetwork(fd);
                      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
                      if (res.ok) router.refresh();
                    })
                  }
                >
                  <p className="text-xs font-medium text-slate-600">Enter a static IP</p>
                  <input name="cidr" placeholder="203.0.113.25 or 203.0.113.24/29" className={inputCls} required />
                  <input name="label" placeholder={`${clinic.name} staff Wi-Fi`} className={inputCls} required maxLength={100} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                  >
                    Approve network
                  </button>
                </form>
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-medium text-slate-600">At the clinic, on staff Wi-Fi?</p>
                  <input
                    value={captureLabel}
                    onChange={(e) => setCaptureLabel(e.target.value)}
                    placeholder="Label (e.g. Main Wi-Fi, backup LTE)"
                    className={inputCls}
                    maxLength={100}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={capture}
                    className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Approve the network I&apos;m on now
                  </button>
                  <p className="text-xs text-slate-400">Only do this while standing in {clinic.name}.</p>
                </div>
              </div>
            ) : null}
            <Note msg={netMsg} />
            {inactive.length > 0 ? (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">Removed networks ({inactive.length})</summary>
                <ul className="mt-1 space-y-1">
                  {inactive.map((n) => (
                    <li key={n.id} className="flex items-center gap-2">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5">{n.cidr}</code> {n.label}
                      {canEdit ? (
                        <button type="button" disabled={busy} onClick={() => toggle(n.id, true)} className="text-emerald-700 hover:underline">
                          Re-approve
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
