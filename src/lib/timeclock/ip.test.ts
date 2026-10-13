import { describe, expect, it } from "vitest";
import { ipInCidr, normalizeCidr, parseCidr, parseIp } from "./ip";

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
