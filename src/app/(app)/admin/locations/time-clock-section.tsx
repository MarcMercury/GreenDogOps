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
} from "./time-clock-actions";
import { GeofenceMap } from "./geofence-map";

// The "Time clock" part of a location card on Admin ▸ Locations: approved IPs
// first (what admins set most), then the geofence and policy.

const inputCls =
  "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50";

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

export function TimeClockSection({ clinic, canEdit, mapsKey }: { clinic: AdminClinic; canEdit: boolean; mapsKey: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [netMsg, setNetMsg] = useState<Msg>(null);
  // Rendered only while open: a map created in a hidden box draws blank.
  const [geoOpen, setGeoOpen] = useState(false);

  const mobile = clinic.clock_policy === "anywhere_logged";
  const usesNetworks = !mobile && clinic.clock_policy !== "geofence_only";
  const active = clinic.networks.filter((n) => n.is_active);
  const inactive = clinic.networks.filter((n) => !n.is_active);

  const addIp = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("location_id", clinic.id);
      fd.set("cidr", ip);
      fd.set("label", label.trim() || "Static IP");
      const res = await addClinicNetwork(fd);
      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) {
        setIp("");
        setLabel("");
        router.refresh();
      }
    });

  const capture = () =>
    start(async () => {
      const res = await captureCurrentNetwork(clinic.id, label);
      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) {
        setLabel("");
        router.refresh();
      }
    });

  const toggle = (id: string, on: boolean) =>
    start(async () => {
      const res = await setNetworkActive(id, on);
      setNetMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time clock</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${LEVEL_STYLE[clinic.health.level]}`}>
          {clinic.health.status}
        </span>
      </div>
      {clinic.health.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {clinic.health.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}

      {usesNetworks ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Approved IP addresses</p>
          {active.length === 0 ? (
            <p className="text-xs text-slate-400">None yet — staff are checked by GPS geofence only.</p>
          ) : (
            <ul className="space-y-1">
              {active.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-800">{n.cidr}</code>{" "}
                    <span className="text-slate-700">{n.label}</span>
                    <span className="block text-slate-400">
                      {n.added_via === "captured" ? "captured on site" : "entered"}
                      {n.added_by_name ? ` by ${n.added_by_name}` : ""} · last matched {when(n.last_matched_at)} ·{" "}
                      {n.match_count} match{n.match_count === 1 ? "" : "es"}
                    </span>
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(n.id, false)}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="Static IP, e.g. 203.0.113.25"
                  className={inputCls}
                  aria-label="Static IP address"
                />
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. Staff Wi-Fi)"
                  maxLength={100}
                  className={inputCls}
                  aria-label="Network label"
                />
                <button
                  type="button"
                  disabled={busy || !ip.trim()}
                  onClick={addIp}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Add IP
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={capture}
                title={`Approves the public IP of the network this device is on. Only use it while standing in ${clinic.name}.`}
                className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
              >
                + Approve the network I&apos;m on now (only while at {clinic.name})
              </button>
            </div>
          ) : null}
          <Note msg={netMsg} />
          {inactive.length > 0 ? (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Removed IPs ({inactive.length})</summary>
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
      ) : mobile ? (
        <p className="text-xs text-slate-500">Mobile — punches are accepted anywhere; the device&apos;s GPS is recorded.</p>
      ) : null}

      <p className="text-[11px] text-slate-400">
        Last 7 days: {clinic.stats.punches7d} punch{clinic.stats.punches7d === 1 ? "" : "es"} · {clinic.stats.offsite7d} off-site ·{" "}
        {clinic.stats.unchecked7d} not checked
      </p>

      <details className="rounded-lg border border-slate-200 px-3 py-2" onToggle={(e) => setGeoOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Geofence &amp; policy
          <span className="ml-2 font-normal text-slate-400">
            {mobile
              ? "anywhere"
              : clinic.latitude !== null
                ? `${clinic.geofence_radius_m} m around the clinic`
                : "no geofence"}
          </span>
        </summary>
        {geoOpen ? <GeofenceSettings clinic={clinic} canEdit={canEdit} mapsKey={mapsKey} /> : null}
      </details>
    </div>
  );
}

function GeofenceSettings({ clinic, canEdit, mapsKey }: { clinic: AdminClinic; canEdit: boolean; mapsKey: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [lat, setLat] = useState(clinic.latitude?.toString() ?? "");
  const [lng, setLng] = useState(clinic.longitude?.toString() ?? "");
  const [radius, setRadius] = useState(String(clinic.geofence_radius_m));
  const [accuracy, setAccuracy] = useState(String(clinic.gps_max_accuracy_m));
  const [policy, setPolicy] = useState<string>(clinic.clock_policy);
  const [msg, setMsg] = useState<Msg>(null);

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const hasPin = lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(latNum) && Number.isFinite(lngNum);
  const mobile = policy === "anywhere_logged";
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
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  const geocode = () =>
    start(async () => {
      const res = await geocodeClinic(clinic.id);
      if (res.ok) {
        setLat(String(res.latitude));
        setLng(String(res.longitude));
        setMsg({ ok: true, text: res.message });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  return (
    <div className="mt-3 space-y-3">
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
          {hasPin ? (
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
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No geofence yet.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">Latitude</span>
              <input value={lat} onChange={(e) => setLat(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="decimal" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">Longitude</span>
              <input value={lng} onChange={(e) => setLng(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="decimal" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">
                Radius (m, {RADIUS_RANGE.min}–{RADIUS_RANGE.max})
              </span>
              <input value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="numeric" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">
                GPS accuracy (±m, {ACCURACY_RANGE.min}–{ACCURACY_RANGE.max})
              </span>
              <input value={accuracy} onChange={(e) => setAccuracy(e.target.value)} disabled={!canEdit} className={inputCls} inputMode="numeric" />
            </label>
          </div>
        </>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {!mobile ? (
            <button
              type="button"
              onClick={geocode}
              disabled={busy || !clinic.address}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Use clinic address
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Save
          </button>
          {!mobile && hasPin ? <span className="text-[11px] text-slate-400">Drag the pin to adjust, then save.</span> : null}
        </div>
      ) : null}
      <Note msg={msg} />
    </div>
  );
}
