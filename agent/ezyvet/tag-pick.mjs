// Pure: choose the right ezyVet tag from the tag search box's suggestions.
//
// Typing a label resolves on its own only when exactly ONE tag matches
// ("selectIfOne"). Two tags can share a name across groups — "AP" (General,
// the Advanced Procedure tag) and "ap" (MyPetClient) — and then nothing
// resolves. Pick explicitly instead: by the known ezyVet id first, else by
// exact title within the expected group, else by exact title alone. Anything
// still ambiguous returns null so the caller refuses the export.

const norm = (s) => (s ?? "").replace(/\u200b/g, "").trim();

/**
 * @param {{id: string|number, title: string, group: string|null}[]} items
 * @param {{label: string, tagId?: string|number|null, group?: string|null}} want
 * @returns {{id: string, title: string, group: string|null} | null}
 */
export function pickTagSuggestion(items, { label, tagId = null, group = null }) {
  const list = items
    .filter((i) => i.id !== undefined && String(i.id) !== "0")
    .map((i) => ({ ...i, id: String(i.id) }));

  if (tagId !== null && tagId !== undefined && String(tagId) !== "") {
    return list.find((i) => i.id === String(tagId)) ?? null;
  }

  const target = norm(label);
  const g = group ? norm(group).toLowerCase() : null;
  const tiers = [
    (i) => norm(i.title) === target && (!g || norm(i.group).toLowerCase() === g),
    (i) => norm(i.title).toLowerCase() === target.toLowerCase() && (!g || norm(i.group).toLowerCase() === g),
    (i) => !g && norm(i.title).toLowerCase() === target.toLowerCase(),
  ];
  for (const match of tiers) {
    const hits = list.filter(match);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}
