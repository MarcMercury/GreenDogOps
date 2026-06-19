"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReferralPartner,
  ZONE_DEFINITIONS,
  REFERRAL_TIERS,
  REFERRAL_PRIORITIES,
  STATUS_OPTIONS,
  partnerName,
  titleCase,
} from "@/lib/crm/referral-types";
import { savePartnerCoords, type SaveCoordsInput } from "./actions";

// ---------------------------------------------------------------------------
// Minimal structural typings for the bits of the Google Maps JS API we use.
// (Avoids pulling in @types/google.maps as a build dependency.)
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
interface GGeocoderResult {
  geometry: { location: { lat(): number; lng(): number } };
}
interface GGeocoder {
  geocode(
    request: { address: string },
    callback: (results: GGeocoderResult[] | null, status: string) => void,
  ): void;
}
interface MapsNamespace {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMapInstance;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  InfoWindow: new (opts?: Record<string, unknown>) => GInfoWindow;
  LatLngBounds: new () => GBounds;
  Geocoder: new () => GGeocoder;
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
// Priority → dot color system
// ---------------------------------------------------------------------------
const PRIORITY_STYLE: Record<string, { color: string; label: string }> = {
  "Very High": { color: "#dc2626", label: "Very High" }, // red-600
  High: { color: "#f97316", label: "High" }, // orange-500
  Medium: { color: "#f59e0b", label: "Medium" }, // amber-500
  Low: { color: "#0ea5e9", label: "Low" }, // sky-500
};
const UNSET_STYLE = { color: "#94a3b8", label: "Unset" }; // slate-400

function priorityStyle(priority: string | null | undefined) {
  return (priority && PRIORITY_STYLE[priority]) || UNSET_STYLE;
}

// ---------------------------------------------------------------------------
// Singleton loader for the Google Maps JS API
// ---------------------------------------------------------------------------
let mapsLoader: Promise<MapsNamespace> | null = null;
function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise<MapsNamespace>((resolve, reject) => {
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
      libraries: "geocoding",
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

export function PartnerMap({
  partners,
  mapsApiKey,
  onView,
  onNotify,
}: {
  partners: ReferralPartner[];
  mapsApiKey: string;
  onView: (p: ReferralPartner) => void;
  onNotify: (msg: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMapInstance | null>(null);
  const mapsRef = useRef<MapsNamespace | null>(null);
  const markersRef = useRef<GMarker[]>([]);
  const infoRef = useRef<GInfoWindow | null>(null);
  // Latest onView without forcing marker rebuilds when the parent re-renders.
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

  // Filters
  const [zone, setZone] = useState("");
  const [tier, setTier] = useState("");
  const [priority, setPriority] = useState("");
  const [partnerStatus, setPartnerStatus] = useState("");
  const [search, setSearch] = useState("");

  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const router = useRouter();

  const hasCoords = useCallback(
    (p: ReferralPartner) => typeof p.latitude === "number" && typeof p.longitude === "number",
    [],
  );

  // Partners that still need geocoding (have an address but no/stale coords).
  const needsGeocode = useMemo(
    () =>
      partners.filter((p) => {
        const addr = p.address?.trim();
        if (!addr) return false;
        return !hasCoords(p) || p.geocoded_address !== addr;
      }),
    [partners, hasCoords],
  );

  const noAddress = useMemo(
    () => partners.filter((p) => !p.address?.trim() && !hasCoords(p)).length,
    [partners, hasCoords],
  );

  // Visible (plottable + filtered) partners.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (!hasCoords(p)) return false;
      if (zone && p.zone !== zone) return false;
      if (tier && p.tier !== tier) return false;
      if (priority && (p.priority || "") !== priority) return false;
      if (partnerStatus && (p.status || "").toLowerCase() !== partnerStatus) return false;
      if (q) {
        const hay = `${partnerName(p)} ${p.address ?? ""} ${p.zone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partners, hasCoords, zone, tier, priority, partnerStatus, search]);

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

    // Clear existing markers.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    infoRef.current?.close();

    const bounds = new maps.LatLngBounds();

    for (const p of visible) {
      const position = { lat: p.latitude as number, lng: p.longitude as number };
      const { color } = priorityStyle(p.priority);
      const marker = new maps.Marker({
        position,
        map,
        title: partnerName(p),
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
          const ps = priorityStyle(p.priority);
          info.setContent(
            `<div style="font:13px/1.4 system-ui,sans-serif;max-width:230px">
              <div style="font-weight:600;color:#0f172a;margin-bottom:2px">${escapeHtml(partnerName(p))}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569">
                  <span style="width:9px;height:9px;border-radius:9999px;background:${ps.color};display:inline-block"></span>${ps.label} priority
                </span>
                ${p.tier ? `<span style="font-size:11px;color:#475569">· ${escapeHtml(p.tier)}</span>` : ""}
              </div>
              ${p.address ? `<div style="color:#64748b;font-size:12px;margin-bottom:6px">${escapeHtml(p.address)}</div>` : ""}
              <button id="gdo-view-${p.id}" style="all:unset;cursor:pointer;color:#047857;font-weight:600;font-size:12px">View details →</button>
            </div>`,
          );
          info.open({ anchor: marker, map });
          // Wire the "View details" button after the InfoWindow renders.
          setTimeout(() => {
            const btn = document.getElementById(`gdo-view-${p.id}`);
            btn?.addEventListener("click", () => {
              info.close();
              onViewRef.current(p);
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
    const maps = mapsRef.current;
    if (!maps || geocoding) return;
    const pending = needsGeocode.filter((p) => p.address?.trim());
    if (pending.length === 0) return;

    const geocoder = new maps.Geocoder();
    setGeocoding(true);
    setProgress(`Geocoding 0 / ${pending.length}…`);

    const geocodeOne = (address: string) =>
      new Promise<{ lat: number; lng: number } | null>((resolve) => {
        geocoder.geocode({ address }, (results, gStatus) => {
          if (gStatus === "OK" && results && results[0]) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else {
            resolve(null);
          }
        });
      });

    (async () => {
      let ok = 0;
      let fail = 0;
      let buffer: SaveCoordsInput[] = [];

      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        const address = (p.address as string).trim();
        setProgress(`Geocoding ${i + 1} / ${pending.length}…`);
        try {
          const loc = await geocodeOne(address);
          if (loc) {
            buffer.push({ id: p.id, lat: loc.lat, lng: loc.lng, address });
            ok++;
          } else {
            fail++;
          }
        } catch {
          fail++;
        }
        // Persist in small batches so progress survives a refresh.
        if (buffer.length >= 25) {
          await savePartnerCoords(buffer);
          buffer = [];
        }
        // Throttle to stay within Google's per-second geocoding limits.
        await new Promise((r) => setTimeout(r, 120));
      }

      if (buffer.length > 0) await savePartnerCoords(buffer);

      setGeocoding(false);
      setProgress(null);
      onNotify(
        `Plotted ${ok} clinic${ok === 1 ? "" : "s"}.${fail ? ` ${fail} address${fail === 1 ? "" : "es"} couldn't be located.` : ""}`,
      );
      router.refresh();
    })();
  }

  const filtersActive = zone || tier || priority || partnerStatus || search;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clinics…"
            className="min-w-[150px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All zones</option>
            {ZONE_DEFINITIONS.map((z) => (
              <option key={z.value} value={z.value}>{z.title}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All priorities</option>
            {REFERRAL_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All tiers</option>
            {REFERRAL_TIERS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={partnerStatus} onChange={(e) => setPartnerStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={() => { setZone(""); setTier(""); setPriority(""); setPartnerStatus(""); setSearch(""); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-medium text-slate-500">Priority:</span>
            {[...REFERRAL_PRIORITIES.map((p) => PRIORITY_STYLE[p]), UNSET_STYLE].map((s) => (
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
            {needsGeocode.length > 0 && (
              <button
                onClick={runGeocode}
                disabled={geocoding}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {geocoding
                  ? progress ?? "Plotting…"
                  : `📍 Plot ${needsGeocode.length} clinic${needsGeocode.length === 1 ? "" : "s"}`}
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
          {visible.length === 0 && "No clinics match the current filters. "}
          {noAddress > 0 && `${noAddress} clinic${noAddress === 1 ? "" : "s"} have no address on file and can't be mapped.`}
        </p>
      )}
    </div>
  );
}
