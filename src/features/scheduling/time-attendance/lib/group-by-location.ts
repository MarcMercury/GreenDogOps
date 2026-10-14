/** The part of a graded shift that decides which clinic section it lands in. */
interface LocatedShift {
  shift: { location_id: string; location_name: string };
}

/**
 * Section the day's graded shifts by clinic, sorted by clinic name. A group
 * takes its name from the first shift seen for that location, and rows stay in
 * the order they arrived (the section sorts them itself).
 */
export function groupByLocation<R extends LocatedShift>(
  graded: readonly R[],
): { id: string; name: string; rows: R[] }[] {
  const byLocation = new Map<string, { name: string; rows: R[] }>();
  for (const g of graded) {
    const entry = byLocation.get(g.shift.location_id) ?? { name: g.shift.location_name, rows: [] };
    entry.rows.push(g);
    byLocation.set(g.shift.location_id, entry);
  }
  return [...byLocation.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, { name, rows }]) => ({ id, name, rows }));
}
