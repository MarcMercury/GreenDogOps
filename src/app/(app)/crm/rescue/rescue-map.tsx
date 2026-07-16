"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type CrmOrganization,
  ORG_STATUS_OPTIONS,
} from "@/lib/crm/types";
import { ZONE_DEFINITIONS } from "@/lib/crm/referral-types";
import { geocodeRescues } from "./actions";

// ---------------------------------------------------------------------------
// Minimal structural typings for the bits of the Google Maps JS API we use.
// ---------------------------------------------------------------------------
type LatLngLiteral = { lat: number; lng: number };
interface GMarker {
  setMap(map: unknown | null): void;
  addListener(event: string, handler: () => void): void;
}
interface GInfoWindow {
  open(opts: { anchor: GMarker; map: unknown }): void;
  setContent(content: string): void;
  close(): void;
}
interface GBounds {
  extend(p: LatLngLiteral): void;
  isEmpty(): boolean;
  getCenter(): LatLngLiteral;
}
interface GMapInstance {
  fitBounds(bounds: GBounds, padding?: number): void;
  setCenter(c: LatLngLiteral): void;
  setZoom(z: number): void;
  addListener(event: string, handler: () => void): void;
}
interface MapsNamespace {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMapInstance;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  InfoWindow: new (opts?: Record<string, unknown>) => GInfoWindow;
  LatLngBounds: new () => GBounds;
  SymbolPath: { CIRCLE: number };
  event: { removeListener(l: unknown): void };
}
type GoogleGlobal = { maps: MapsNamespace };

declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

// ---------------------------------------------------------------------------
// Status → dot color system
// ---------------------------------------------------------------------------
const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  active: { color: "#059669", label: "Active" }, // emerald-600
  prospect: { color: "#0ea5e9", label: "Prospect" }, // sky-500
  lead: { color: "#6366f1", label: "Lead" }, // indigo-500
  pending: { color: "#f59e0b", label: "Pending" }, // amber-500
  inactive: { color: "#94a3b8", label: "Inactive" }, // slate-400
};
const UNSET_STYLE = { color: "#cbd5e1", label: "Unset" }; // slate-300

function statusStyle(status: string | null | undefined) {
  const key = (status ?? "").toLowerCase();
  return STATUS_STYLE[key] ?? UNSET_STYLE;
}

// ---------------------------------------------------------------------------
// Singleton loader for the Google Maps JS API
// ---------------------------------------------------------------------------
const AUTH_FAILURE_MESSAGE =
  "Google Maps rejected this site's API key. Check the key's HTTP-referrer restrictions, billing, and that the Maps JavaScript API is enabled.";
let mapsAuthFailed = false;
let authFailureHandler: (() => void) | null = null;
function registerAuthFailureHandler(fn: (() => void) | null) {
  authFailureHandler = fn;
  if (fn && mapsAuthFailed) fn();
}

let mapsLoader: Promise<MapsNamespace> | null = null;
function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise<MapsNamespace>((resolve, reject) => {
    (window as unknown as Record<string, unknown>).gm_authFailure = () => {
      mapsAuthFailed = true;
      authFailureHandler?.();
    };
    const callbackName = "__gdoGoogleMapsReady";
    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps failed to initialize."));
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      callback: callbackName,
      loading: "async",
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      mapsLoader = null;
      reject(new Error("Could not load the Google Maps script."));
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Greater Los Angeles fallback center.
const DEFAULT_CENTER: LatLngLiteral = { lat: 34.0522, lng: -118.2437 };

export function RescueMap({
  rescues,
  mapsApiKey,
  onView,
  onNotify,
  canEdit,
}: {
  rescues: CrmOrganization[];
  mapsApiKey: string;
  onView: (r: CrmOrganization) => void;
  onNotify: (msg: string) => void;
  canEdit: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMapInstance | null>(null);
  const mapsRef = useRef<MapsNamespace | null>(null);
  const markersRef = useRef<GMarker[]>([]);
  const infoRef = useRef<GInfoWindow | null>(null);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    mapsApiKey ? "loading" : "error",
  );
  const [errorMsg, setErrorMsg] = useState<string>(
    mapsApiKey
      ? ""
      : "No Google Maps browser key found. Set GOOGLE_MAPS_PUBLIC_KEY (or GOOGLE_MAPS_API_KEY) in your environment.",
  );

  useEffect(() => {
    registerAuthFailureHandler(() => {
      setStatus("error");
      setErrorMsg(AUTH_FAILURE_MESSAGE);
    });
    return () => registerAuthFailureHandler(null);
  }, []);

  const [zone, setZone] = useState("");
  const [rescueStatus, setRescueStatus] = useState("");
  const [search, setSearch] = useState("");

  const [geocoding, startGeocode] = useTransition();

  const hasCoords = useCallback(
    (r: CrmOrganization) => typeof r.latitude === "number" && typeof r.longitude === "number",
    [],
  );

  const needsGeocode = useMemo(
    () =>
      rescues.filter((r) => {
        const addr = r.address?.trim();
        if (!addr) return false;
        return !hasCoords(r) || r.geocoded_address !== addr;
      }),
    [rescues, hasCoords],
  );

  const noAddress = useMemo(
    () => rescues.filter((r) => !r.address?.trim() && !hasCoords(r)).length,
    [rescues, hasCoords],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rescues.filter((r) => {
      if (!hasCoords(r)) return false;
      if (zone && r.area !== zone) return false;
      if (rescueStatus && (r.status || "").toLowerCase() !== rescueStatus) return false;
      if (q) {
        const hay = `${r.name} ${r.address ?? ""} ${r.area ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rescues, hasCoords, zone, rescueStatus, search]);

  // ----- Load map once -----
  useEffect(() => {
    if (!mapsApiKey) return;
    let cancelled = false;
    loadGoogleMaps(mapsApiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapsRef.current = maps;
        mapRef.current = new maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 9,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        infoRef.current = new maps.InfoWindow();
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err.message || "Failed to load Google Maps.");
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  // ----- Render markers when data or filters change -----
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !maps || !map) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    infoRef.current?.close();

    const bounds = new maps.LatLngBounds();

    for (const r of visible) {
      const position = { lat: r.latitude as number, lng: r.longitude as number };
      const { color } = statusStyle(r.status);
      const marker = new maps.Marker({
        position,
        map,
        title: r.name,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        const info = infoRef.current;
        if (info) {
          const ss = statusStyle(r.status);
          info.setContent(
            `<div style="font:13px/1.4 system-ui,sans-serif;max-width:230px">
              <div style="font-weight:600;color:#0f172a;margin-bottom:2px">${escapeHtml(r.name)}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569">
                  <span style="width:9px;height:9px;border-radius:9999px;background:${ss.color};display:inline-block"></span>${ss.label}
                </span>
                ${
                  r.verified_adoptions != null
                    ? `<span style="font-size:11px;color:#475569">· ${r.verified_adoptions} adoptions</span>`
                    : ""
                }
              </div>
              ${r.address ? `<div style="color:#64748b;font-size:12px;margin-bottom:6px">${escapeHtml(r.address)}</div>` : ""}
              <button id="gdo-view-${r.id}" style="all:unset;cursor:pointer;color:#047857;font-weight:600;font-size:12px">View details →</button>
            </div>`,
          );
          info.open({ anchor: marker, map });
          setTimeout(() => {
            const btn = document.getElementById(`gdo-view-${r.id}`);
            btn?.addEventListener("click", () => {
              info.close();
              onViewRef.current(r);
            });
          }, 0);
        }
      });

      markersRef.current.push(marker);
      bounds.extend(position);
    }

    if (!bounds.isEmpty()) {
      if (visible.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 48);
      }
    }
  }, [visible, status]);

  function runGeocode() {
    startGeocode(async () => {
      const r = await geocodeRescues();
      onNotify(r.ok ? r.message : `Geocode error: ${r.error}`);
    });
  }

  const filtersActive = zone || rescueStatus || search;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rescues…"
            className="min-w-[150px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All areas</option>
            {ZONE_DEFINITIONS.map((z) => (
              <option key={z.value} value={z.value}>{z.title}</option>
            ))}
          </select>
          <select value={rescueStatus} onChange={(e) => setRescueStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All statuses</option>
            {ORG_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={() => { setZone(""); setRescueStatus(""); setSearch(""); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-medium text-slate-500">Status:</span>
            {[...ORG_STATUS_OPTIONS.map((o) => statusStyle(o.value)), UNSET_STYLE].map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full ring-2 ring-white" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              <span className="font-semibold text-slate-700">{visible.length}</span> shown
            </span>
            {canEdit && needsGeocode.length > 0 && (
              <button
                onClick={runGeocode}
                disabled={geocoding}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {geocoding ? "Plotting…" : `📍 Plot ${needsGeocode.length} rescue${needsGeocode.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100 shadow-sm">
        <div ref={containerRef} className="h-[clamp(420px,60vh,720px)] w-full" />
        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 p-6 text-center">
            {status === "loading" ? (
              <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
                Loading map…
              </div>
            ) : (
              <div className="max-w-sm text-sm text-slate-600">
                <p className="font-medium text-slate-800">Map unavailable</p>
                <p className="mt-1 text-slate-500">{errorMsg}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footnotes */}
      {status === "ready" && (visible.length === 0 || noAddress > 0) && (
        <p className="text-xs text-slate-400">
          {visible.length === 0 && "No rescues match the current filters. "}
          {noAddress > 0 && `${noAddress} rescue${noAddress === 1 ? "" : "s"} have no address on file and can't be mapped.`}
        </p>
      )}
    </div>
  );
}
