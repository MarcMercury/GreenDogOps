import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCURACY_RANGE, clinicHealth, RADIUS_RANGE, validateClockSettings, type ClinicHealthInput } from "./clinic-settings";

const ok = { latitude: "33.99", longitude: "-118.46", radius: "150", accuracy: "100", policy: "network_or_geofence" };

describe("validateClockSettings", () => {
  it("accepts valid settings, with or without a geofence", () => {
    expect(validateClockSettings(ok)).toEqual({
      ok: true,
      value: { latitude: 33.99, longitude: -118.46, geofence_radius_m: 150, gps_max_accuracy_m: 100, clock_policy: "network_or_geofence" },
    });
    const none = validateClockSettings({ ...ok, latitude: "", longitude: " " });
    expect(none.ok && none.value.latitude).toBeNull();
  });
  it("rejects half a coordinate, out-of-range values and unknown policies", () => {
    for (const bad of [
      { latitude: "", longitude: "-118" },
      { latitude: "91" },
      { longitude: "-181" },
      { latitude: "abc" },
      { radius: "10" },
      { radius: "150.5" },
      { radius: "" },
      { accuracy: "6000" },
      { policy: "everywhere" },
    ]) {
      expect(validateClockSettings({ ...ok, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("matches the database CHECK constraints in 0241", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0241_time_clock_location_and_approvals.sql"), "utf8");
    expect(sql).toContain(`geofence_radius_m between ${RADIUS_RANGE.min} and ${RADIUS_RANGE.max}`);
    expect(sql).toContain(`gps_max_accuracy_m between ${ACCURACY_RANGE.min} and ${ACCURACY_RANGE.max}`);
  });
});

const NOW = new Date("2026-10-13T20:00:00Z");
const base: ClinicHealthInput = {
  policy: "network_or_geofence",
  hasGeofence: true,
  activeNetworks: 1,
  lastNetworkMatch: "2026-10-13T15:00:00Z",
  punches24h: 10,
  punches7d: 60,
  offsite7d: 1,
};

describe("clinicHealth", () => {
  it("is green with a network and a geofence that keep matching", () => {
    expect(clinicHealth(base, NOW)).toMatchObject({ level: "ok", warnings: [] });
  });
  it("shows geofence-only while the static IP is pending", () => {
    expect(clinicHealth({ ...base, activeNetworks: 0, lastNetworkMatch: null }, NOW)).toMatchObject({
      level: "warn",
      status: expect.stringMatching(/geofence only/),
    });
  });
  it("is off with nothing configured", () => {
    expect(clinicHealth({ ...base, activeNetworks: 0, hasGeofence: false }, NOW).level).toBe("off");
  });
  it("warns when staff punched but no network matched in 24 hours", () => {
    const h = clinicHealth({ ...base, lastNetworkMatch: "2026-10-11T15:00:00Z" }, NOW);
    expect(h.level).toBe("warn");
    expect(h.warnings[0]).toMatch(/IP may have changed/);
    expect(clinicHealth({ ...base, lastNetworkMatch: null, punches24h: 0 }, NOW).warnings).toEqual([]);
  });
  it("warns on an off-site spike, not on the odd one", () => {
    expect(clinicHealth({ ...base, offsite7d: 20 }, NOW).warnings.join()).toMatch(/off-site/);
    expect(clinicHealth({ ...base, offsite7d: 2, punches7d: 4 }, NOW).warnings).toEqual([]);
  });
  it("treats mobile as always fine and flags policies that can't be checked", () => {
    expect(clinicHealth({ ...base, policy: "anywhere_logged", activeNetworks: 0, hasGeofence: false }, NOW).level).toBe("ok");
    expect(clinicHealth({ ...base, policy: "network_only", activeNetworks: 0 }, NOW)).toMatchObject({ level: "off" });
    expect(clinicHealth({ ...base, policy: "geofence_only", hasGeofence: false }, NOW).warnings.join()).toMatch(/geofence-only/);
  });
});
