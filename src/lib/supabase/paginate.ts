import "server-only";

/** PostgREST hard-caps every response at `max_rows` (1000 on this project). */
export const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Fetch every row from a PostgREST query, paging past the server-side
 * `max_rows` cap (1000). Pass a factory that applies `.range(from, to)` to a
 * fresh query on each call; rows are concatenated until a short page returns.
 *
 * Mirrors the `{ data, error }` shape of a normal Supabase response so call
 * sites can keep their existing error handling. On error, returns the rows
 * gathered so far plus the error.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

/**
 * Like `fetchAllRows`, but fetches pages concurrently. `count` should return
 * the exact row count for the same filters (e.g. a `{ count: "exact", head:
 * true }` query); it runs alongside the first page, then every remaining page
 * is requested at once. The `page` query must have a deterministic order
 * (include a unique tiebreaker such as `id`) so pages don't overlap.
 *
 * Falls back to sequential paging if the count is unavailable, and keeps
 * paging sequentially if rows were added between the count and the fetch.
 */
export async function fetchAllRowsConcurrent<T>(
  count: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const [counted, first] = await Promise.all([count(), page(0, PAGE_SIZE - 1)]);
  if (first.error) return { data: [], error: first.error };
  const all: T[] = [...(first.data ?? [])];
  if (all.length < PAGE_SIZE) return { data: all, error: null };

  let from = PAGE_SIZE;
  if (!counted.error && counted.count != null && counted.count > PAGE_SIZE) {
    const starts: number[] = [];
    for (let s = PAGE_SIZE; s < counted.count; s += PAGE_SIZE) starts.push(s);
    const pages = await Promise.all(starts.map((s) => page(s, s + PAGE_SIZE - 1)));
    for (const p of pages) {
      if (p.error) return { data: all, error: p.error };
      all.push(...(p.data ?? []));
    }
    const lastLen = pages[pages.length - 1].data?.length ?? 0;
    if (lastLen < PAGE_SIZE) return { data: all, error: null };
    from = starts[starts.length - 1] + PAGE_SIZE;
  }

  for (; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

/**
 * Run an async mapper over `items` with bounded concurrency, preserving input
 * order in the results. Use for fan-out work (e.g. external API calls) that
 * would otherwise be serialized in a `for await` loop.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) break;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
