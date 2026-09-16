import "server-only";

/** PostgREST caps an unbounded select at `max-rows` (1000 on this project). */
const PAGE_SIZE = 1000;

/**
 * Minimal shape of a PostgREST query that can be paged. Typed structurally on
 * purpose: `PostgrestFilterBuilder`'s generics differ between the copies
 * hoisted into node_modules, and pinning to them breaks the build.
 */
interface PageableQuery {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Read an entire table through PostgREST.
 *
 * Silently truncating at 1000 rows is the worst possible failure for the sheet
 * syncs: `person` is past that mark, so a truncated roster makes existing staff
 * look absent and the HR sync re-inserts them as duplicates. Always page.
 */
export async function fetchAllRows<T>(build: () => PageableQuery): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}
