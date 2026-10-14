/**
 * A department's colour lightened towards white, as an opaque `rgb(...)`.
 * The section rows are sticky; a translucent tint would let the cells
 * scrolling under them show through, so the tint is pre-mixed.
 */
export function tintOf(hex: string, strength = 0.12): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(100, 116, 139, ${strength})`;
  const mix = (c: number) => Math.round(255 - (255 - c) * strength);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

/** `#rgb` / `#rrggbb` → [r, g, b], or null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
