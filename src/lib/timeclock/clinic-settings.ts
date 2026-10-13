// Admin ▸ Time Clock rules — pure. Validation mirrors the CHECK constraints in
// migration 0241; health mirrors go-live plan §F ("keeping it working").

import { CLOCK_POLICIES, type ClockPolicy } from "./location-check";

export const RADIUS_RANGE = { min: 25, max: 5000 } as const;
export const ACCURACY_RANGE = { min: 5, max: 5000 } as const;

export const POLICY_LABELS: Record<ClockPolicy, string> = {
  network_or_geofence: "Approved network or geofence (recommended)",
  network_only: "Approved network only",
  geofence_only: "Geofence only",
  anywhere_logged: "Anywhere (location recorded) — mobile",
};

export interface ClockSettingsInput {
  latitude: string;
  longitude: string;
  radius: string;
  accuracy: string;
  policy: string;
}

export interface ClockSettings {
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  gps_max_accuracy_m: number;
  clock_policy: ClockPolicy;
}

export type SettingsValidation = { ok: true; value: ClockSettings } | { ok: false; error: string };

function num(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function validateClockSettings(input: ClockSettingsInput): SettingsValidation {
  if (!(CLOCK_POLICIES as readonly string[]).includes(input.policy)) return { ok: false, error: "Pick a clock policy." };
  const lat = num(input.latitude);
  const lng = num(input.longitude);
  if ((lat === null) !== (lng === null)) return { ok: false, error: "Enter both latitude and longitude, or neither." };
  if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) return { ok: false, error: "Latitude must be between -90 and 90." };
  if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) return { ok: false, error: "Longitude must be between -180 and 180." };
  const radius = num(input.radius);
  if (radius === null || Number.isNaN(radius) || !Number.isInteger(radius) || radius < RADIUS_RANGE.min || radius > RADIUS_RANGE.max) {
    return { ok: false, error: `Geofence radius must be a whole number of metres from ${RADIUS_RANGE.min} to ${RADIUS_RANGE.max}.` };
  }
  const accuracy = num(input.accuracy);
  if (accuracy === null || Number.isNaN(accuracy) || !Number.isInteger(accuracy) || accuracy < ACCURACY_RANGE.min || accuracy > ACCURACY_RANGE.max) {
    return { ok: false, error: `Required GPS accuracy must be a whole number of metres from ${ACCURACY_RANGE.min} to ${ACCURACY_RANGE.max}.` };
  }
  return {
    ok: true,
    value: {
      latitude: lat,
      longitude: lng,
      geofence_radius_m: radius,
      gps_max_accuracy_m: accuracy,
      clock_policy: input.policy as ClockPolicy,
    },
  };
}

export interface ClinicHealthInput {
  policy: ClockPolicy;
  hasGeofence: boolean;
  activeNetworks: number;
  /** Most recent match of any active network at this clinic. */
  lastNetworkMatch: string | null;
  /** Punches scheduled at this clinic in the last 24 hours. */
  punches24h: number;
  /** Punches at this clinic in the last 7 days, and how many were off-site. */
  punches7d: number;
  offsite7d: number;
}

export type HealthLevel = "ok" | "warn" | "off";

export interface ClinicHealth {
  level: HealthLevel;
  /** Headline shown on the clinic card. */
  status: string;
  warnings: string[];
}

export const OFFSITE_WARN_MIN = 3;
export const OFFSITE_WARN_SHARE = 0.25;

export function clinicHealth(input: ClinicHealthInput, now: Date = new Date()): ClinicHealth {
  if (input.policy === "anywhere_logged") {
    return { level: "ok", status: "Accepts punches from anywhere (location recorded)", warnings: [] };
  }
  const usesNetwork = input.policy !== "geofence_only";
  const usesGeofence = input.policy !== "network_only";
  const network = usesNetwork && input.activeNetworks > 0;
  const fence = usesGeofence && input.hasGeofence;

  const warnings: string[] = [];
  if (network && input.punches24h > 0) {
    const matched = input.lastNetworkMatch !== null && now.getTime() - new Date(input.lastNetworkMatch).getTime() <= 86_400_000;
    if (!matched) {
      warnings.push("Staff punched here in the last 24 hours but no approved network matched. The clinic's IP may have changed, or there's a typo.");
    }
  }
  if (input.offsite7d >= OFFSITE_WARN_MIN && input.offsite7d >= input.punches7d * OFFSITE_WARN_SHARE) {
    warnings.push(`${input.offsite7d} of ${input.punches7d} punches here in the last 7 days were off-site. Check the geofence and networks.`);
  }
  if (input.policy === "network_only" && input.activeNetworks === 0) {
    warnings.push("Policy is network-only but no network is approved, so punches here are not checked.");
  }
  if (input.policy === "geofence_only" && !input.hasGeofence) {
    warnings.push("Policy is geofence-only but no geofence is set, so punches here are not checked.");
  }

  if (!network && !fence) {
    return { level: "off", status: "Not set up — punches here are recorded but not checked", warnings };
  }
  if (usesNetwork && !network) {
    return { level: "warn", status: "No approved network — geofence only", warnings };
  }
  if (usesGeofence && !fence) {
    return { level: "warn", status: "No geofence — approved network only (phones on cellular will show off-site)", warnings };
  }
  return { level: warnings.length ? "warn" : "ok", status: network && fence ? "Network and geofence set" : network ? "Approved network set" : "Geofence set", warnings };
}
