// IPv4 / IPv6 parsing and CIDR matching — pure, no dependencies. Used for the
// time-clock network check: an approved clinic network is a single public IP
// (/32 or /128) or a range.

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

function parseIpv4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255 || (p.length > 1 && p.startsWith("0"))) return null;
    v = (v << BigInt(8)) | BigInt(n);
  }
  return v;
}

function parseIpv6(s: string): bigint | null {
  let text = s;
  // Embedded IPv4 tail, e.g. ::ffff:203.0.113.5
  let tail: bigint | null = null;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".") && lastColon >= 0) {
    tail = parseIpv4(text.slice(lastColon + 1));
    if (tail === null) return null;
    text = `${text.slice(0, lastColon)}:0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  let v = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    v = (v << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  if (tail !== null) v = (v & ~BigInt(0xffffffff)) | tail;
  return v;
}

/** Parse an IP address; IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as IPv4. */
export function parseIp(raw: string | null | undefined): ParsedIp | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (!s) return null;
  if (!s.includes(":")) {
    const v4 = parseIpv4(s);
    return v4 === null ? null : { version: 4, value: v4 };
  }
  const v6 = parseIpv6(s);
  if (v6 === null) return null;
  const mappedPrefix = BigInt(0xffff) << BigInt(32);
  if (v6 >> BigInt(32) === mappedPrefix >> BigInt(32)) {
    return { version: 4, value: v6 & BigInt(0xffffffff) };
  }
  return { version: 6, value: v6 };
}

export interface ParsedCidr {
  version: 4 | 6;
  network: bigint;
  prefix: number;
}

/** Parse "203.0.113.25", "203.0.113.24/29" or an IPv6 equivalent. Host bits must be zero. */
export function parseCidr(raw: string | null | undefined): ParsedCidr | null {
  if (!raw) return null;
  const [addr, prefixText, extra] = raw.trim().split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  let prefix = bits;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > bits) return null;
  }
  const hostBits = BigInt(bits - prefix);
  const mask = hostBits === BigInt(0) ? BigInt(0) : (BigInt(1) << hostBits) - BigInt(1);
  if ((ip.value & mask) !== BigInt(0)) return null;
  return { version: ip.version, network: ip.value, prefix };
}

export function ipInCidr(ip: ParsedIp, cidr: ParsedCidr): boolean {
  if (ip.version !== cidr.version) return false;
  const bits = ip.version === 4 ? 32 : 128;
  const shift = BigInt(bits - cidr.prefix);
  return ip.value >> shift === cidr.network >> shift;
}

/** Canonical text for storage and display ("203.0.113.25/32"). Null if invalid. */
export function normalizeCidr(raw: string | null | undefined): string | null {
  const c = parseCidr(raw);
  if (!c) return null;
  if (c.version === 4) {
    const v = c.network;
    const octets = [24, 16, 8, 0].map((s) => Number((v >> BigInt(s)) & BigInt(255)));
    return `${octets.join(".")}/${c.prefix}`;
  }
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) groups.push(((c.network >> BigInt(i * 16)) & BigInt(0xffff)).toString(16));
  return `${groups.join(":")}/${c.prefix}`;
}
