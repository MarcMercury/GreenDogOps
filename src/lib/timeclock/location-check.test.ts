import { describe, expect, it } from "vitest";
import { distanceMeters } from "./geo";
import { evaluateLocation, isConfigured, type ClockLocation, type PunchEvidence } from "./location-check";

// Venice-ish and Van Nuys-ish coordinates (synthetic).
const VENICE = { lat: 33.99, lng: -118.46 };
const VAN_NUYS = { lat: 34.19, lng: -118.45 };

function loc(id: string, over: Partial<ClockLocation> = {}): ClockLocation {
  return {
    id,
    name: id,
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    gps_max_accuracy_m: 100,
    clock_policy: "network_or_geofence",
    networks: [],
    ...over,
  };
}
const ev = (over: Partial<PunchEvidence> = {}): PunchEvidence => ({ ip: null, latitude: null, longitude: null, accuracy: null, ...over });

const venice = loc("Venice", { latitude: VENICE.lat, longitude: VENICE.lng, networks: [{ id: "n-ven", cidr: "203.0.113.25/32" }] });
const vanNuys = loc("Van Nuys", { latitude: VAN_NUYS.lat, longitude: VAN_NUYS.lng });
const mobile = loc("MPMV", { clock_policy: "anywhere_logged" });
const unconfigured = loc("Sherman Oaks");
const ALL = [venice, vanNuys, mobile, unconfigured];

describe("distanceMeters", () => {
  it("is about 22 km between the two synthetic clinics and 0 for the same point", () => {
    const d = distanceMeters(VENICE.lat, VENICE.lng, VAN_NUYS.lat, VAN_NUYS.lng);
    expect(d).toBeGreaterThan(22_000);
    expect(d).toBeLessThan(23_000);
    expect(distanceMeters(1, 2, 1, 2)).toBe(0);
  });
});

describe("evaluateLocation", () => {
  it("accepts the scheduled clinic's network (desktops have no GPS)", () => {
    const r = evaluateLocation(ALL, "Venice", ev({ ip: "203.0.113.25" }));
    expect(r).toMatchObject({ result: "on_site", matchedLocationId: "Venice", networkId: "n-ven", method: "network" });
  });

  it("accepts an accurate GPS fix inside the geofence", () => {
    const r = evaluateLocation(ALL, "Van Nuys", ev({ latitude: VAN_NUYS.lat + 0.0005, longitude: VAN_NUYS.lng, accuracy: 20 }));
    expect(r.result).toBe("on_site");
    expect(r.method).toBe("geofence");
    expect(r.distanceM).toBeLessThan(150);
  });

  it("does not trust an imprecise fix, even at the right spot", () => {
    const r = evaluateLocation(ALL, "Van Nuys", ev({ latitude: VAN_NUYS.lat, longitude: VAN_NUYS.lng, accuracy: 900 }));
    expect(r.result).toBe("off_site");
    expect(r.reason).toMatch(/too imprecise/);
  });

  it("flags another clinic as other_clinic (accepted)", () => {
    const r = evaluateLocation(ALL, "Van Nuys", ev({ ip: "203.0.113.25" }));
    expect(r).toMatchObject({ result: "other_clinic", matchedLocationId: "Venice", method: "network" });
  });

  it("sends a failed check off-site with an explanation", () => {
    const r = evaluateLocation(ALL, "Venice", ev({ ip: "198.51.100.7", latitude: VAN_NUYS.lat + 0.1, longitude: VAN_NUYS.lng, accuracy: 10 }));
    expect(r.result).toBe("off_site");
    expect(r.matchedLocationId).toBeNull();
    expect(r.reason).toMatch(/not on an approved network/);
    expect(r.distanceM).toBeGreaterThan(1000);
  });

  it("off-site when location permission is denied and the network is unknown", () => {
    expect(evaluateLocation(ALL, "Venice", ev({ ip: "198.51.100.7" })).result).toBe("off_site");
  });

  it("always accepts at a mobile location, but never matches it for other punches", () => {
    expect(evaluateLocation(ALL, "MPMV", ev()).result).toBe("on_site");
    expect(evaluateLocation(ALL, "MPMV", ev()).method).toBe("anywhere");
    expect(evaluateLocation(ALL, "Venice", ev({ ip: "198.51.100.7" })).result).toBe("off_site");
  });

  it("does not judge a clinic that has nothing configured", () => {
    const r = evaluateLocation(ALL, "Sherman Oaks", ev({ ip: "198.51.100.7" }));
    expect(r.result).toBe("not_checked");
    expect(isConfigured(unconfigured)).toBe(false);
  });

  it("checks unscheduled work against every clinic", () => {
    expect(evaluateLocation(ALL, null, ev({ ip: "203.0.113.25" }))).toMatchObject({ result: "on_site", matchedLocationId: "Venice" });
    expect(evaluateLocation(ALL, null, ev({ ip: "198.51.100.7" })).result).toBe("off_site");
    expect(evaluateLocation([unconfigured, mobile], null, ev({ ip: "198.51.100.7" })).result).toBe("not_checked");
  });

  it("honours network-only and geofence-only policies", () => {
    const netOnly = loc("N", { clock_policy: "network_only", latitude: VENICE.lat, longitude: VENICE.lng, networks: [{ id: "n", cidr: "203.0.113.0/24" }] });
    expect(evaluateLocation([netOnly], "N", ev({ latitude: VENICE.lat, longitude: VENICE.lng, accuracy: 5 })).result).toBe("off_site");
    expect(evaluateLocation([netOnly], "N", ev({ ip: "203.0.113.9" })).result).toBe("on_site");
    const geoOnly = loc("G", { clock_policy: "geofence_only", latitude: VENICE.lat, longitude: VENICE.lng, networks: [{ id: "n", cidr: "203.0.113.0/24" }] });
    expect(evaluateLocation([geoOnly], "G", ev({ ip: "203.0.113.9" })).result).toBe("off_site");
    expect(isConfigured(loc("x", { clock_policy: "network_only", latitude: 1, longitude: 1 }))).toBe(false);
  });
});
