import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PAGE_SIZE, fetchAllRowsConcurrent } from "./paginate";

function table(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: number[] = [];
  const page = vi.fn(async (from: number, to: number) => {
    calls.push(from);
    return { data: rows.slice(from, to + 1), error: null };
  });
  return { rows, page, calls };
}

describe("fetchAllRowsConcurrent", () => {
  it("returns a single short page without extra requests", async () => {
    const { page } = table(10);
    const res = await fetchAllRowsConcurrent(async () => ({ count: 10, error: null }), page);
    expect(res.data).toHaveLength(10);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("fetches every page in order using the count", async () => {
    const total = PAGE_SIZE * 3 + 352;
    const { rows, page, calls } = table(total);
    const res = await fetchAllRowsConcurrent(async () => ({ count: total, error: null }), page);
    expect(res.error).toBeNull();
    expect(res.data).toEqual(rows);
    expect(calls.sort((a, b) => a - b)).toEqual([0, 1000, 2000, 3000]);
  });

  it("keeps paging when rows were added after the count", async () => {
    const total = PAGE_SIZE * 2 + 5;
    const { rows, page } = table(total);
    const res = await fetchAllRowsConcurrent(async () => ({ count: PAGE_SIZE * 2, error: null }), page);
    expect(res.data).toEqual(rows);
  });

  it("falls back to sequential paging when the count fails", async () => {
    const total = PAGE_SIZE * 2 + 1;
    const { rows, page } = table(total);
    const res = await fetchAllRowsConcurrent(
      async () => ({ count: null, error: { message: "nope" } }),
      page,
    );
    expect(res.data).toEqual(rows);
  });

  it("surfaces page errors", async () => {
    const res = await fetchAllRowsConcurrent(
      async () => ({ count: PAGE_SIZE * 2, error: null }),
      async (from) =>
        from === 0
          ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => i), error: null }
          : { data: null, error: { message: "boom" } },
    );
    expect(res.error?.message).toBe("boom");
  });
});
