// The time-clock location check (go-live plan §F, D6) — pure. Two independent
// signals; either is enough under the default policy:
//   network  — the request's public IP is one of the clinic's approved networks
//   geofence — the device's GPS is inside the clinic's radius, accurately enough
// The scheduled clinic is checked first, then every other clinic. A clinic with
// nothing configured cannot be judged, so the punch is 'not_checked' rather
// than sent to approval. Mobile ('anywhere_logged') locations always accept.

import { distanceMeters } from "./geo";
import { ipInCidr, parseCidr, parseIp } from "./ip";

export type ClockPolicy = "network_or_geofence" | "network_only" | "geofence_only" | "anywhere_logged";
export const CLOCK_POLICIES: readonly ClockPolicy[] = [
  "network_or_geofence",
  "network_only",
  "geofence_only",
  "anywhere_logged",
];

export interface ClockNetwork {
  id: string;
  cidr: string;
}

export interface ClockLocation {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  gps_max_accuracy_m: number;
  clock_policy: ClockPolicy;
  /** Active approved networks only. */
  networks: ClockNetwork[];
}

export interface PunchEvidence {
  ip: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Reported GPS accuracy radius in metres. */
  accuracy: number | null;
}

export type LocationResult = "not_checked" | "on_site" | "other_clinic" | "off_site";

export interface LocationCheck {
  result: LocationResult;
  matchedLocationId: string | null;
  networkId: string | null;
  method: "network" | "geofence" | "anywhere" | null;
  /** Distance to the scheduled clinic (or the matched / nearest clinic), when GPS is known. */
  distanceM: number | null;
  /** Plain-English explanation (shown to approvers and in "Test from here"). */
  reason: string;
}

const hasGeofence = (l: ClockLocation) => l.latitude !== null && l.longitude !== null;

/** Can this clinic be judged at all under its policy? */
export function isConfigured(l: ClockLocation): boolean {
  switch (l.clock_policy) {
    case "anywhere_logged":
      return true;
    case "network_only":
      return l.networks.length > 0;
    case "geofence_only":
      return hasGeofence(l);
    default:
      return l.networks.length > 0 || hasGeofence(l);
  }
}

interface Match {
  method: "network" | "geofence" | "anywhere";
  networkId: string | null;
  distanceM: number | null;
}

function gpsOf(ev: PunchEvidence) {
  return ev.latitude !== null && ev.longitude !== null ? { lat: ev.latitude, lng: ev.longitude } : null;
}

function distanceTo(l: ClockLocation, ev: PunchEvidence): number | null {
  const gps = gpsOf(ev);
  if (!gps || !hasGeofence(l)) return null;
  return distanceMeters(gps.lat, gps.lng, l.latitude as number, l.longitude as number);
}

export function matchLocation(l: ClockLocation, ev: PunchEvidence): Match | null {
  if (l.clock_policy === "anywhere_logged") return { method: "anywhere", networkId: null, distanceM: distanceTo(l, ev) };
  const ip = parseIp(ev.ip);
  if (l.clock_policy !== "geofence_only" && ip) {
    for (const n of l.networks) {
      const cidr = parseCidr(n.cidr);
      if (cidr && ipInCidr(ip, cidr)) return { method: "network", networkId: n.id, distanceM: distanceTo(l, ev) };
    }
  }
  if (l.clock_policy !== "network_only" && hasGeofence(l)) {
    const d = distanceTo(l, ev);
    const accurate = ev.accuracy !== null && ev.accuracy <= l.gps_max_accuracy_m;
    if (d !== null && accurate && d <= l.geofence_radius_m) return { method: "geofence", networkId: null, distanceM: d };
  }
  return null;
}

function describe(name: string, m: Match): string {
  if (m.method === "anywhere") return `${name} accepts punches from anywhere (location recorded).`;
  if (m.method === "network") return `On ${name}'s approved network.`;
  return `Within ${name}'s geofence (${Math.round(m.distanceM ?? 0)} m away).`;
}

function whyNot(l: ClockLocation, ev: PunchEvidence): string {
  const parts: string[] = [];
  if (l.clock_policy !== "geofence_only" && l.networks.length > 0) {
    parts.push(ev.ip ? "not on an approved network" : "network unknown");
  }
  if (l.clock_policy !== "network_only" && hasGeofence(l)) {
    const d = distanceTo(l, ev);
    if (d === null) parts.push("no location from the device");
    else if (ev.accuracy === null || ev.accuracy > l.gps_max_accuracy_m) {
      parts.push(`location too imprecise (±${Math.round(ev.accuracy ?? 0)} m, need ±${l.gps_max_accuracy_m} m)`);
    } else parts.push(`${Math.round(d)} m away (fence ${l.geofence_radius_m} m)`);
  }
  return `${l.name}: ${parts.join(", ") || "nothing to check against"}`;
}

/**
 * Evaluate a punch. `scheduledLocationId` is the clinic of the matched shift
 * (null for unscheduled work, which is checked against every clinic).
 */
export function evaluateLocation(
  locations: readonly ClockLocation[],
  scheduledLocationId: string | null,
  ev: PunchEvidence,
): LocationCheck {
  const scheduled = scheduledLocationId ? locations.find((l) => l.id === scheduledLocationId) ?? null : null;

  if (scheduled) {
    const m = matchLocation(scheduled, ev);
    if (m) {
      return {
        result: "on_site",
        matchedLocationId: scheduled.id,
        networkId: m.networkId,
        method: m.method,
        distanceM: m.distanceM,
        reason: describe(scheduled.name, m),
      };
    }
  }

  // Other clinics (never a mobile/anywhere location: that would accept everything).
  const others = locations.filter(
    (l) => l.id !== scheduled?.id && l.clock_policy !== "anywhere_logged" && isConfigured(l),
  );
  const matches = others
    .map((l) => ({ l, m: matchLocation(l, ev) }))
    .filter((x): x is { l: ClockLocation; m: Match } => x.m !== null)
    .sort((a, b) => (a.m.method === "network" ? 0 : 1) - (b.m.method === "network" ? 0 : 1) || (a.m.distanceM ?? 0) - (b.m.distanceM ?? 0));
  if (matches.length > 0) {
    const { l, m } = matches[0];
    return {
      result: scheduled ? "other_clinic" : "on_site",
      matchedLocationId: l.id,
      networkId: m.networkId,
      method: m.method,
      distanceM: scheduled ? distanceTo(scheduled, ev) ?? m.distanceM : m.distanceM,
      reason: scheduled ? `Not at ${scheduled.name}. ${describe(l.name, m)}` : describe(l.name, m),
    };
  }

  if (scheduled && !isConfigured(scheduled)) {
    return {
      result: "not_checked",
      matchedLocationId: null,
      networkId: null,
      method: null,
      distanceM: null,
      reason: `${scheduled.name} has no geofence or approved network yet, so the location was recorded but not checked.`,
    };
  }
  if (!scheduled && others.length === 0) {
    return {
      result: "not_checked",
      matchedLocationId: null,
      networkId: null,
      method: null,
      distanceM: null,
      reason: "No clinic has a geofence or approved network yet, so the location was recorded but not checked.",
    };
  }

  const nearest = [...(scheduled ? [scheduled] : others)]
    .map((l) => distanceTo(l, ev))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];
  const checked = scheduled && isConfigured(scheduled) ? [scheduled, ...others] : others;
  return {
    result: "off_site",
    matchedLocationId: null,
    networkId: null,
    method: null,
    distanceM: nearest ?? null,
    reason: `Not at a Green Dog clinic — ${checked.slice(0, 3).map((l) => whyNot(l, ev)).join("; ")}.`,
  };
}

/** Short labels for queues and timecards. */
export const LOCATION_RESULT_LABELS: Record<LocationResult, string> = {
  not_checked: "Not checked",
  on_site: "At the clinic",
  other_clinic: "At another clinic",
  off_site: "Off-site",
};
