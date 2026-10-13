import { describe, expect, it } from "vitest";
import { hostCidr, ipInCidr, isPublicIp, normalizeCidr, parseCidr, parseIp, validateClinicNetwork } from "./ip";

const inRange = (ip: string, cidr: string) => ipInCidr(parseIp(ip)!, parseCidr(cidr)!);

describe("parseIp", () => {
  it("parses IPv4, IPv6 and IPv4-mapped IPv6", () => {
    expect(parseIp("203.0.113.25")).toEqual({ version: 4, value: BigInt(0xcb007119) });
    expect(parseIp("::ffff:203.0.113.25")).toEqual({ version: 4, value: BigInt(0xcb007119) });
    expect(parseIp("2001:db8::1")?.version).toBe(6);
    expect(parseIp("[2001:db8::1]")?.version).toBe(6);
    expect(parseIp("fe80::1%eth0")?.version).toBe(6);
  });
  it("rejects junk", () => {
    for (const bad of ["", "unknown", "256.1.1.1", "1.2.3", "01.2.3.4", "1.2.3.4.5", "2001:db8:::1", "g::1", null, undefined]) {
      expect(parseIp(bad), String(bad)).toBeNull();
    }
  });
});

describe("CIDR", () => {
  it("matches single IPs and ranges", () => {
    expect(inRange("203.0.113.25", "203.0.113.25")).toBe(true);
    expect(inRange("203.0.113.26", "203.0.113.25/32")).toBe(false);
    expect(inRange("203.0.113.30", "203.0.113.24/29")).toBe(true);
    expect(inRange("203.0.113.32", "203.0.113.24/29")).toBe(false);
    expect(inRange("2001:db8:0:1::5", "2001:db8::/32")).toBe(true);
    expect(inRange("2001:db9::5", "2001:db8::/32")).toBe(false);
    expect(inRange("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });
  it("never matches across IP versions", () => {
    expect(inRange("203.0.113.25", "::/0")).toBe(false);
  });
  it("rejects ranges with host bits set or bad prefixes", () => {
    for (const bad of ["203.0.113.25/29", "203.0.113.0/33", "203.0.113.0/-1", "203.0.113.0/2/3", "x/24"]) {
      expect(parseCidr(bad), bad).toBeNull();
    }
  });
  it("normalizes for storage", () => {
    expect(normalizeCidr(" 203.0.113.25 ")).toBe("203.0.113.25/32");
    expect(normalizeCidr("203.0.113.24/29")).toBe("203.0.113.24/29");
    expect(normalizeCidr("2001:DB8::/32")).toBe("2001:db8:0:0:0:0:0:0/32");
    expect(normalizeCidr("nope")).toBeNull();
  });
});

describe("validateClinicNetwork", () => {
  it("accepts a public static IP or block and normalizes it", () => {
    expect(validateClinicNetwork(" 203.0.113.25 ")).toEqual({ ok: true, cidr: "203.0.113.25/32" });
    expect(validateClinicNetwork("203.0.113.24/29")).toEqual({ ok: true, cidr: "203.0.113.24/29" });
    expect(validateClinicNetwork("2600:1700:1:2::/64")).toEqual({ ok: true, cidr: "2600:1700:1:2:0:0:0:0/64" });
  });
  it("rejects private, internal and carrier-NAT addresses", () => {
    for (const bad of ["192.168.1.1", "10.0.0.5", "172.20.1.1", "100.64.3.2", "127.0.0.1", "169.254.1.1", "fe80::1", "fd00::1", "::1"]) {
      const r = validateClinicNetwork(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/private or internal/);
    }
  });
  it("rejects ranges that are too broad, malformed, or have host bits set", () => {
    expect(validateClinicNetwork("203.0.112.0/23")).toMatchObject({ ok: false, error: expect.stringMatching(/too broad/) });
    expect(validateClinicNetwork("2600:1700::/32")).toMatchObject({ ok: false, error: expect.stringMatching(/too broad/) });
    expect(validateClinicNetwork("203.0.113.25/29")).toMatchObject({ ok: false, error: expect.stringMatching(/host bits/) });
    expect(validateClinicNetwork("clinic wifi")).toMatchObject({ ok: false, error: expect.stringMatching(/valid IP/) });
    expect(validateClinicNetwork("")).toMatchObject({ ok: false });
  });
  it("builds a single-address network from the IP the server saw", () => {
    expect(hostCidr(parseIp("203.0.113.25")!)).toBe("203.0.113.25/32");
    expect(hostCidr(parseIp("::ffff:203.0.113.25")!)).toBe("203.0.113.25/32");
    expect(hostCidr(parseIp("2600:1700::5")!)).toBe("2600:1700:0:0:0:0:0:5/128");
    expect(isPublicIp(parseIp("8.8.8.8")!)).toBe(true);
  });
});
