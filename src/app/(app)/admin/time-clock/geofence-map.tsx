"use client";

import { useEffect, useRef, useState } from "react";

// Geofence preview: the clinic pin (draggable when editing) and its radius.
// Minimal structural typings; window.google is read through a local cast so
// this file does not add another global declaration.
type LatLng = { lat: number; lng: number };
interface GMap {
  setCenter(c: LatLng): void;
  fitBounds(b: unknown, padding?: number): void;
}
interface GMarker {
  setPosition(p: LatLng): void;
  getPosition(): { lat(): number; lng(): number } | null;
  addListener(event: string, handler: () => void): void;
}
interface GCircle {
  setCenter(c: LatLng): void;
  setRadius(r: number): void;
  getBounds(): unknown;
}
interface Maps {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  Circle: new (opts: Record<string, unknown>) => GCircle;
}
const gmaps = () => (window as unknown as { google?: { maps?: Maps } }).google?.maps ?? null;

let loader: Promise<Maps> | null = null;
function loadMaps(apiKey: string): Promise<Maps> {
  const ready = gmaps();
  if (ready) return Promise.resolve(ready);
  if (loader) return loader;
  loader = new Promise<Maps>((resolve, reject) => {
    const cb = "__gdoGeofenceMapsReady";
    (window as unknown as Record<string, unknown>)[cb] = () => {
      const m = gmaps();
      if (m) resolve(m);
      else reject(new Error("Google Maps failed to initialise."));
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: apiKey, callback: cb, loading: "async", v: "weekly" })}`;
    s.async = true;
    s.onerror = () => {
      loader = null;
      reject(new Error("Could not load Google Maps."));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export function GeofenceMap({
  apiKey,
  latitude,
  longitude,
  radius,
  editable,
  onMove,
}: {
  apiKey: string;
  latitude: number;
  longitude: number;
  radius: number;
  editable: boolean;
  onMove: (lat: number, lng: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const objs = useRef<{ map: GMap; marker: GMarker; circle: GCircle } | null>(null);
  const onMoveRef = useRef(onMove);
  const [error, setError] = useState<string | null>(apiKey ? null : "No Google Maps key configured.");

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!apiKey || !el.current || objs.current) return;
    let cancelled = false;
    loadMaps(apiKey)
      .then((maps) => {
        if (cancelled || !el.current) return;
        const center = { lat: latitude, lng: longitude };
        const map = new maps.Map(el.current, { center, zoom: 17, mapTypeId: "hybrid", streetViewControl: false, fullscreenControl: false });
        const marker = new maps.Marker({ position: center, map, draggable: editable, title: "Clinic" });
        const circle = new maps.Circle({
          map,
          center,
          radius,
          strokeColor: "#059669",
          strokeWeight: 2,
          fillColor: "#10b981",
          fillOpacity: 0.15,
          clickable: false,
        });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (!p) return;
          circle.setCenter({ lat: p.lat(), lng: p.lng() });
          onMoveRef.current(p.lat(), p.lng());
        });
        map.fitBounds(circle.getBounds(), 24);
        objs.current = { map, marker, circle };
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
    // Created once; later prop changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    const o = objs.current;
    if (!o) return;
    const c = { lat: latitude, lng: longitude };
    o.marker.setPosition(c);
    o.circle.setCenter(c);
    o.circle.setRadius(radius);
  }, [latitude, longitude, radius]);

  if (error) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Map unavailable ({error}).{" "}
        <a
          className="text-emerald-700 underline"
          href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Open the pin in Google Maps
        </a>
      </p>
    );
  }
  return <div ref={el} className="h-64 w-full overflow-hidden rounded-xl border border-slate-200" />;
}
